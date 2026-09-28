package de.koecheclub.speichercheck;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.provider.MediaStore;
import android.database.Cursor;
import android.text.format.Formatter;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.MediaController;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.widget.VideoView;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

import org.json.JSONObject;

public class MainActivity extends Activity {

    enum Risk { GREEN, YELLOW, RED }

    static class Candidate {
        final File file;
        final long size;
        final Risk risk;
        final String reason;
        final File referenceCopy;
        final int duplicateGroup;

        Candidate(File file, long size, Risk risk, String reason) {
            this(file, size, risk, reason, null, 0);
        }

        Candidate(File file, long size, Risk risk, String reason, File referenceCopy, int duplicateGroup) {
            this.file = file;
            this.size = size;
            this.risk = risk;
            this.reason = reason;
            this.referenceCopy = referenceCopy;
            this.duplicateGroup = duplicateGroup;
        }

        String display(Activity a) {
            String mark = risk == Risk.GREEN ? "🟢" : risk == Risk.YELLOW ? "🟡" : "🔴";
            String type = file.isDirectory() ? "ORDNER" : "DATEI";
            String name = file.getName();
            if (name == null || name.trim().isEmpty()) name = file.getAbsolutePath();
            String group = duplicateGroup > 0 ? " · Gruppe " + duplicateGroup : "";
            return mark + "  " + name + "\n"
                    + type + " · " + Formatter.formatFileSize(a, size) + group + " · " + reason + "\n"
                    + file.getAbsolutePath();
        }
    }

    private final List<Candidate> candidates = new ArrayList<>();
    private final List<String> displayRows = new ArrayList<>();
    private ArrayAdapter<String> adapter;
    private TextView status;
    private TextView summary;
    private ProgressBar progress;
    private ListView list;
    private final Handler uiHandler = new Handler(Looper.getMainLooper());
    private volatile int scanProgressPercent = 0;
    private volatile String scanProgressPhase = "Bereit";
    private volatile long scanStartedAtElapsed = 0L;
    private final Runnable scanElapsedTicker = new Runnable() {
        @Override
        public void run() {
            if (!scanning) return;
            renderScanProgress();
            uiHandler.postDelayed(this, 1000L);
        }
    };
    private Button permissionButton;
    private Button scanButton;
    private Button autoCleanButton;
    private Button deleteButton;
    private Button reportButton;
    private Button shareReportButton;
    private Button updateButton;
    private ImageButton searchButton;
    private volatile boolean scanning = false;
    private volatile boolean fileSearchRunning = false;
    private volatile ScanState lastScanState;

    private static final String UPDATE_MANIFEST_URL =
            "https://raw.githubusercontent.com/Sire65/KC-System-Check/main/android/kc-speichercheck/update.json";
    private static final long UPDATE_CHECK_INTERVAL = 24L * 60L * 60L * 1000L;
    private static final String PREFS = "kc_speichercheck";

    static class UpdateInfo {
        final int versionCode;
        final String versionName;
        final String apkUrl;
        final String sha256;
        final String notes;

        UpdateInfo(int versionCode, String versionName, String apkUrl, String sha256, String notes) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.apkUrl = apkUrl == null ? "" : apkUrl.trim();
            this.sha256 = sha256 == null ? "" : sha256.trim().toLowerCase(Locale.ROOT);
            this.notes = notes == null ? "" : notes.trim();
        }
    }

    private static final long MB = 1024L * 1024L;
    private static final long DAY = 24L * 60L * 60L * 1000L;
    private static final long RECENT_ARCHIVE_PROTECTION = 3L * DAY;
    private static final int MAX_VISIBLE = 500;

    private static final Set<String> GENERATED_DIRS = new HashSet<>();
    private static final Set<String> ARCHIVE_EXT = new HashSet<>();
    private static final Set<String> TEMP_EXT = new HashSet<>();

    static {
        Collections.addAll(GENERATED_DIRS,
                "node_modules", ".gradle", "build", "dist", "out", "target", ".cache",
                "__pycache__", ".pytest_cache", ".mypy_cache", ".next", ".expo",
                "coverage", ".parcel-cache", ".dart_tool", ".terraform");
        Collections.addAll(ARCHIVE_EXT, "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "apk", "aab");
        Collections.addAll(TEMP_EXT, "tmp", "temp", "log", "dmp", "cache", "part", "crdownload");
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildUi();
        refreshPermissionUi();
        registerUpdateReceiver();
        maybeCheckForUpdates();
        getWindow().getDecorView().postDelayed(() -> requestHomeScreenShortcut(true), 800);
    }

    private void buildUi() {
        int pad = dp(14);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);

        TextView title = new TextView(this);
        title.setText("KC SpeicherCheck · v" + BuildConfig.VERSION_NAME);
        title.setTextSize(20);
        title.setTextColor(Color.BLACK);
        title.setPadding(0, 0, 0, dp(2));
        root.addView(title);

        TextView info = new TextView(this);
        info.setText("Scannt den gemeinsamen Gerätespeicher. Internet wird nur für Updates genutzt.");
        info.setTextSize(12);
        info.setPadding(0, 0, 0, dp(3));
        root.addView(info);

        LinearLayout row1 = new LinearLayout(this);
        row1.setOrientation(LinearLayout.HORIZONTAL);

        permissionButton = new Button(this);
        permissionButton.setText("Zugriff");
        permissionButton.setOnClickListener(v -> requestStorageAccess());
        styleCompactButton(permissionButton);
        row1.addView(permissionButton, compactButtonParams());

        scanButton = new Button(this);
        scanButton.setText("Scannen");
        scanButton.setOnClickListener(v -> startScan());
        styleCompactButton(scanButton);
        row1.addView(scanButton, compactButtonParams());

        autoCleanButton = new Button(this);
        autoCleanButton.setText("Auto löschen");
        autoCleanButton.setEnabled(false);
        autoCleanButton.setOnClickListener(v -> confirmAutoCleanup());
        styleCompactButton(autoCleanButton);
        row1.addView(autoCleanButton, compactButtonParams());
        root.addView(row1);

        LinearLayout row2 = new LinearLayout(this);
        row2.setOrientation(LinearLayout.HORIZONTAL);

        deleteButton = new Button(this);
        deleteButton.setText("Auswahl löschen");
        deleteButton.setEnabled(false);
        deleteButton.setOnClickListener(v -> confirmDelete());
        styleCompactButton(deleteButton);
        row2.addView(deleteButton, compactButtonParams());

        reportButton = new Button(this);
        reportButton.setText("Bericht");
        reportButton.setEnabled(false);
        reportButton.setOnClickListener(v -> saveReport());
        styleCompactButton(reportButton);
        row2.addView(reportButton, compactButtonParams());

        shareReportButton = new Button(this);
        shareReportButton.setText("Teilen");
        shareReportButton.setEnabled(false);
        shareReportButton.setOnClickListener(v -> shareReport());
        styleCompactButton(shareReportButton);
        row2.addView(shareReportButton, compactButtonParams());
        root.addView(row2);

        LinearLayout row3 = new LinearLayout(this);
        row3.setOrientation(LinearLayout.HORIZONTAL);

        updateButton = new Button(this);
        updateButton.setText("Update");
        updateButton.setOnClickListener(v -> checkForUpdates(true));
        styleCompactButton(updateButton);
        row3.addView(updateButton, compactButtonParams());

        Button shortcutButton = new Button(this);
        shortcutButton.setText("Start-Icon");
        shortcutButton.setOnClickListener(v -> requestHomeScreenShortcut(false));
        styleCompactButton(shortcutButton);
        row3.addView(shortcutButton, compactButtonParams());

        searchButton = new ImageButton(this);
        searchButton.setImageResource(android.R.drawable.ic_menu_search);
        searchButton.setContentDescription("Datei suchen");
        searchButton.setPadding(dp(8), dp(8), dp(8), dp(8));
        searchButton.setOnClickListener(v -> showFileSearchDialog());
        row3.addView(searchButton, new LinearLayout.LayoutParams(dp(42), dp(42)));
        root.addView(row3);

        status = new TextView(this);
        status.setText("Bereit");
        status.setPadding(0, dp(6), 0, dp(3));
        root.addView(status);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(false);
        progress.setMax(100);
        progress.setProgress(0);
        progress.setVisibility(View.GONE);
        root.addView(progress, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(8)));

        summary = new TextView(this);
        summary.setText("Noch kein Scan.");
        summary.setTextSize(14);
        summary.setPadding(0, dp(6), 0, dp(6));
        root.addView(summary);

        TextView legend = new TextView(this);
        legend.setText("🟢 löschbar/temporär   🟡 prüfen   🔴 geschützt\nDoppeltipp auf Treffer = Foto/Video/Details. Dubletten bleiben manuell; Auto löscht nur streng sichere Download-Treffer.");
        legend.setTextSize(12);
        root.addView(legend);

        LinearLayout selectRow = new LinearLayout(this);
        selectRow.setOrientation(LinearLayout.HORIZONTAL);

        Button selectAllButton = new Button(this);
        selectAllButton.setText("Alle markieren");
        selectAllButton.setOnClickListener(v -> setAllChecked(true));
        styleCompactButton(selectAllButton);
        selectRow.addView(selectAllButton, new LinearLayout.LayoutParams(0, dp(38), 1));

        Button selectNoneButton = new Button(this);
        selectNoneButton.setText("Keine markieren");
        selectNoneButton.setOnClickListener(v -> setAllChecked(false));
        styleCompactButton(selectNoneButton);
        selectRow.addView(selectNoneButton, new LinearLayout.LayoutParams(0, dp(38), 1));

        root.addView(selectRow);

        list = new ListView(this);
        list.setChoiceMode(ListView.CHOICE_MODE_MULTIPLE);
        adapter = new ArrayAdapter<String>(this, android.R.layout.simple_list_item_multiple_choice, displayRows) {
            @Override
            public View getView(int position, View convertView, android.view.ViewGroup parent) {
                View v = super.getView(position, convertView, parent);
                TextView tv = (TextView) v;
                tv.setTextSize(13);
                tv.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
                tv.setSingleLine(false);
                tv.setMaxLines(6);
                tv.setMinHeight(dp(86));
                tv.setPadding(dp(8), dp(8), dp(8), dp(8));
                Candidate c = candidates.get(position);
                if (c.risk == Risk.GREEN) tv.setTextColor(Color.rgb(27, 94, 32));
                else if (c.risk == Risk.YELLOW) tv.setTextColor(Color.rgb(120, 90, 0));
                else tv.setTextColor(Color.rgb(183, 28, 28));
                return v;
            }
        };
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> updateSelectedSummary());

        GestureDetector previewGesture = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override
            public boolean onDown(MotionEvent e) {
                return true;
            }

            @Override
            public boolean onDoubleTap(MotionEvent e) {
                int position = list.pointToPosition((int) e.getX(), (int) e.getY());
                if (position != ListView.INVALID_POSITION) showCandidatePreview(position);
                return true;
            }
        });
        list.setOnTouchListener((v, event) -> {
            previewGesture.onTouchEvent(event);
            return false;
        });

        root.addView(list, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1));

        setContentView(root);
    }

    private void styleCompactButton(Button button) {
        button.setTextSize(10.5f);
        button.setAllCaps(false);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(3), 0, dp(3), 0);
    }

    private LinearLayout.LayoutParams compactButtonParams() {
        return new LinearLayout.LayoutParams(0, dp(42), 1);
    }


    private void showFileSearchDialog() {
        if (!hasStorageAccess()) {
            requestStorageAccess();
            return;
        }
        if (scanning) {
            Toast.makeText(this, "Während des Speicher-Scans bitte kurz warten.", Toast.LENGTH_SHORT).show();
            return;
        }

        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(18), dp(4), dp(18), 0);

        TextView hint = new TextView(this);
        hint.setText("Dateiname oder Teil davon eingeben. Für ZIP-Dateien geht auch *.zip oder zip.");
        hint.setTextSize(12);
        hint.setPadding(0, 0, 0, dp(6));
        body.addView(hint);

        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("z. B. projektname.zip oder *.zip");
        body.addView(input, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        AlertDialog dialog = new AlertDialog.Builder(this)
                .setTitle("Datei suchen")
                .setView(body)
                .setNegativeButton("Abbrechen", null)
                .setNeutralButton("Neueste ZIPs", (d, w) -> startFileSearch("*.zip"))
                .setPositiveButton("Suchen", (d, w) -> startFileSearch(input.getText().toString()))
                .create();
        dialog.setOnShowListener(d -> {
            input.requestFocus();
            dialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE);
        });
        dialog.show();
    }

    private void startFileSearch(String rawQuery) {
        if (!hasStorageAccess()) {
            requestStorageAccess();
            return;
        }

        String query = rawQuery == null ? "" : rawQuery.trim();
        if (query.isEmpty()) {
            Toast.makeText(this, "Bitte einen Dateinamen oder *.zip eingeben.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (scanning) {
            Toast.makeText(this, "Während des Speicher-Scans bitte kurz warten.", Toast.LENGTH_SHORT).show();
            return;
        }
        if (fileSearchRunning) {
            Toast.makeText(this, "Die Dateisuche läuft bereits.", Toast.LENGTH_SHORT).show();
            return;
        }

        fileSearchRunning = true;
        if (searchButton != null) searchButton.setEnabled(false);
        status.setText("Dateisuche: " + query + " …");

        new Thread(() -> {
            try {
                List<File> found = new ArrayList<>();
                long[] checked = new long[] {0L, 0L};
                for (File storageRoot : listEmulatedStorageRoots()) {
                    searchFiles(storageRoot, query, found, 0, checked);
                }
                augmentFileSearchFromMediaStore(query, found, checked);

                found.sort((a, b) -> {
                    int byDate = Long.compare(b.lastModified(), a.lastModified());
                    if (byDate != 0) return byDate;
                    return a.getAbsolutePath().compareToIgnoreCase(b.getAbsolutePath());
                });

                int total = found.size();
                int visibleCount = Math.min(250, total);
                List<File> visible = new ArrayList<>(found.subList(0, visibleCount));
                runOnUiThread(() -> {
                    fileSearchRunning = false;
                    if (searchButton != null) searchButton.setEnabled(true);
                    status.setText("Dateisuche: " + total + " Treffer · neueste zuerst");
                    showFileSearchResults(query, visible, total, checked[0], checked[1]);
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    fileSearchRunning = false;
                    if (searchButton != null) searchButton.setEnabled(true);
                    status.setText("Dateisuche fehlgeschlagen.");
                    Toast.makeText(this, "Dateisuche fehlgeschlagen: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    private void searchFiles(File node, String query, List<File> found, int depth, long[] checked) {
        if (node == null || !node.exists() || depth > 80) return;
        if (isExcludedPath(node.getAbsolutePath())) return;

        if (node.isDirectory()) {
            checked[1]++;
            File[] children;
            try {
                children = node.listFiles();
            } catch (SecurityException e) {
                return;
            }
            if (children == null) return;
            for (File child : children) {
                searchFiles(child, query, found, depth + 1, checked);
            }
            return;
        }

        checked[0]++;
        if (matchesFileSearch(node, query)) found.add(node);

        if (checked[0] % 1000L == 0L) {
            long n = checked[0];
            runOnUiThread(() -> {
                if (fileSearchRunning && status != null) {
                    status.setText("Dateisuche … " + n + " Dateien geprüft");
                }
            });
        }
    }

    private void augmentFileSearchFromMediaStore(String query, List<File> found, long[] checked) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || found == null) return;

        Set<String> known = new HashSet<>();
        for (File f : found) {
            if (f != null) known.add(f.getAbsolutePath());
        }

        Uri uri = MediaStore.Files.getContentUri("external");
        String[] projection = new String[] {
                MediaStore.Files.FileColumns.DATA,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.RELATIVE_PATH
        };

        try (Cursor cursor = getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor == null) return;
            int dataCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATA);
            int nameCol = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int relCol = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH);

            while (cursor.moveToNext()) {
                String name = nameCol >= 0 ? cursor.getString(nameCol) : null;
                String data = dataCol >= 0 ? cursor.getString(dataCol) : null;
                String rel = relCol >= 0 ? cursor.getString(relCol) : null;
                File candidate = resolveIndexedFile(data, rel, name);
                if (candidate == null || !candidate.exists() || !candidate.isFile()) continue;
                if (isExcludedPath(candidate.getAbsolutePath())) continue;
                checked[0]++;
                if (matchesFileSearch(candidate, query) && known.add(candidate.getAbsolutePath())) {
                    found.add(candidate);
                }
            }
        } catch (Exception ignored) { }
    }

    private File resolveIndexedFile(String data, String relativePath, String displayName) {
        if (data != null && !data.trim().isEmpty()) {
            File direct = new File(data);
            if (direct.exists()) return direct;
        }
        if (displayName == null || displayName.trim().isEmpty()) return null;
        if (relativePath != null && !relativePath.trim().isEmpty()) {
            return new File(Environment.getExternalStorageDirectory(), relativePath + displayName);
        }
        return new File(Environment.getExternalStorageDirectory(), displayName);
    }

    private boolean matchesFileSearch(File file, String rawQuery) {
        if (file == null || !file.isFile()) return false;
        String q = rawQuery == null ? "" : rawQuery.trim().toLowerCase(Locale.ROOT);
        if (q.isEmpty()) return false;

        String name = file.getName() == null ? "" : file.getName().toLowerCase(Locale.ROOT);
        String path = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);

        if (q.equals("zip") || q.equals(".zip") || q.equals("*.zip")) {
            return name.endsWith(".zip");
        }
        if (q.startsWith("*.") && q.indexOf('*', 1) < 0) {
            return name.endsWith(q.substring(1));
        }
        if (q.indexOf('*') >= 0) {
            return wildcardMatch(name, q) || wildcardMatch(path, q);
        }
        return name.contains(q) || path.contains(q);
    }

    private boolean wildcardMatch(String text, String pattern) {
        if (text == null || pattern == null) return false;
        String[] parts = pattern.split("\\*", -1);
        int pos = 0;
        boolean anchoredStart = !pattern.startsWith("*");
        boolean anchoredEnd = !pattern.endsWith("*");
        boolean firstPart = true;
        String lastNonEmpty = "";

        for (String part : parts) {
            if (part.isEmpty()) continue;
            int at = text.indexOf(part, pos);
            if (at < 0) return false;
            if (firstPart && anchoredStart && at != 0) return false;
            pos = at + part.length();
            firstPart = false;
            lastNonEmpty = part;
        }
        if (anchoredEnd && !lastNonEmpty.isEmpty() && !text.endsWith(lastNonEmpty)) return false;
        return true;
    }

    private void showFileSearchResults(String query, List<File> files, int total, long checkedFiles, long checkedDirs) {
        if (files.isEmpty()) {
            new AlertDialog.Builder(this)
                    .setTitle("Keine Datei gefunden")
                    .setMessage("Für „" + query + "“ wurde kein Treffer gefunden.\n\nGeprüft: " +
                            checkedFiles + " Dateien in " + checkedDirs + " Ordnern.")
                    .setNegativeButton("Schließen", null)
                    .setPositiveButton("Neue Suche", (d, w) -> showFileSearchDialog())
                    .show();
            return;
        }

        List<String> rows = new ArrayList<>();
        SimpleDateFormat df = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY);
        for (File f : files) {
            rows.add(f.getName() + "\n" +
                    Formatter.formatFileSize(this, f.length()) + " · " +
                    df.format(new Date(f.lastModified())) + "\n" +
                    f.getAbsolutePath());
        }

        ListView resultList = new ListView(this);
        ArrayAdapter<String> resultAdapter = new ArrayAdapter<String>(
                this, android.R.layout.simple_list_item_1, rows) {
            @Override
            public View getView(int position, View convertView, android.view.ViewGroup parent) {
                View v = super.getView(position, convertView, parent);
                TextView tv = (TextView) v;
                tv.setTextSize(12.5f);
                tv.setSingleLine(false);
                tv.setMaxLines(4);
                tv.setPadding(dp(10), dp(8), dp(10), dp(8));
                return v;
            }
        };
        resultList.setAdapter(resultAdapter);

        String title = total > files.size()
                ? "Dateisuche · " + total + " Treffer (erste " + files.size() + ")"
                : "Dateisuche · " + total + " Treffer";

        AlertDialog resultsDialog = new AlertDialog.Builder(this)
                .setTitle(title)
                .setView(resultList)
                .setNegativeButton("Schließen", null)
                .setPositiveButton("Neue Suche", (d, w) -> showFileSearchDialog())
                .create();

        resultList.setOnItemClickListener((parent, view, position, id) -> {
            File file = files.get(position);
            showFoundFileDetails(file);
        });

        resultsDialog.show();
    }

    private void showFoundFileDetails(File file) {
        if (file == null) return;
        String parent = file.getParentFile() == null ? "" : file.getParentFile().getAbsolutePath();
        String details = file.getName() + "\n" +
                Formatter.formatFileSize(this, file.length()) + "\n" +
                new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY)
                        .format(new Date(file.lastModified())) +
                "\n\nOrdner:\n" + parent +
                "\n\nVollständiger Pfad:\n" + file.getAbsolutePath();

        new AlertDialog.Builder(this)
                .setTitle("Gefundene Datei")
                .setMessage(details)
                .setNegativeButton("Schließen", null)
                .setPositiveButton("Pfad kopieren", (d, w) -> copyPathToClipboard(file))
                .show();
    }

    private void copyPathToClipboard(File file) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        if (clipboard == null || file == null) {
            Toast.makeText(this, "Pfad konnte nicht kopiert werden.", Toast.LENGTH_SHORT).show();
            return;
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("Dateipfad", file.getAbsolutePath()));
        Toast.makeText(this, "Dateipfad kopiert.", Toast.LENGTH_SHORT).show();
    }

    private void beginScanProgress() {
        scanStartedAtElapsed = SystemClock.elapsedRealtime();
        scanProgressPercent = 0;
        scanProgressPhase = "Vorbereitung";
        progress.setIndeterminate(false);
        progress.setMax(100);
        progress.setProgress(0);
        progress.setVisibility(View.VISIBLE);
        uiHandler.removeCallbacks(scanElapsedTicker);
        renderScanProgress();
        uiHandler.postDelayed(scanElapsedTicker, 1000L);
    }

    private void setScanProgress(int percent, String phase) {
        int bounded = Math.max(0, Math.min(99, percent));
        if (bounded > scanProgressPercent) scanProgressPercent = bounded;
        if (phase != null && !phase.trim().isEmpty()) scanProgressPhase = phase;
        runOnUiThread(this::renderScanProgress);
    }

    private void renderScanProgress() {
        if (progress == null || status == null) return;
        progress.setProgress(Math.max(0, Math.min(100, scanProgressPercent)));
        long elapsed = scanStartedAtElapsed > 0
                ? Math.max(0L, SystemClock.elapsedRealtime() - scanStartedAtElapsed) : 0L;
        status.setText(scanProgressPercent + "% · Laufzeit " +
                formatElapsed(elapsed) + " · " + scanProgressPhase);
    }

    private String formatElapsed(long millis) {
        long seconds = Math.max(0L, millis / 1000L);
        long hours = seconds / 3600L;
        long minutes = (seconds % 3600L) / 60L;
        long secs = seconds % 60L;
        if (hours > 0) {
            return String.format(Locale.GERMANY, "%02d:%02d:%02d", hours, minutes, secs);
        }
        return String.format(Locale.GERMANY, "%02d:%02d", minutes, secs);
    }

    private void finishScanProgress(ScanState state) {
        uiHandler.removeCallbacks(scanElapsedTicker);
        scanProgressPercent = 100;
        scanProgressPhase = "Fertig – alle Treffer sind aufgelistet";
        progress.setProgress(100);
        long elapsed = scanStartedAtElapsed > 0
                ? Math.max(0L, SystemClock.elapsedRealtime() - scanStartedAtElapsed) : 0L;
        status.setText("100% · Laufzeit " + formatElapsed(elapsed) +
                " · Scan abgeschlossen: " + state.files + " Dateien, " +
                state.dirs + " Ordner geprüft.");
    }

    private void requestHomeScreenShortcut(boolean automaticFirstRun) {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (automaticFirstRun && p.getBoolean("shortcut_prompted", false)) return;

        ShortcutManager shortcutManager = getSystemService(ShortcutManager.class);
        if (shortcutManager == null || !shortcutManager.isRequestPinShortcutSupported()) {
            if (!automaticFirstRun) {
                Toast.makeText(this,
                        "Dein Android-Launcher unterstützt das automatische Anheften nicht. Bitte KC SpeicherCheck in der App-Liste gedrückt halten und auf den Startbildschirm ziehen.",
                        Toast.LENGTH_LONG).show();
            }
            return;
        }

        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_MAIN);
        launchIntent.addCategory(Intent.CATEGORY_LAUNCHER);

        ShortcutInfo shortcut = new ShortcutInfo.Builder(this, "kc_speichercheck_home")
                .setShortLabel("KC SpeicherCheck")
                .setLongLabel("KC SpeicherCheck")
                .setIcon(Icon.createWithResource(this, R.drawable.ic_kc_speichercheck))
                .setIntent(launchIntent)
                .build();

        boolean requested = shortcutManager.requestPinShortcut(shortcut, null);
        if (requested) {
            p.edit().putBoolean("shortcut_prompted", true).apply();
            if (!automaticFirstRun) {
                Toast.makeText(this, "Bitte das Anheften des KC-SpeicherCheck-Icons bestätigen.", Toast.LENGTH_LONG).show();
            }
        } else if (!automaticFirstRun) {
            Toast.makeText(this,
                    "Das Icon konnte nicht automatisch angeheftet werden. Bitte die App in der App-Liste gedrückt halten und auf den Startbildschirm ziehen.",
                    Toast.LENGTH_LONG).show();
        }
    }

    private int dp(int n) {
        return (int) (n * getResources().getDisplayMetrics().density + 0.5f);
    }

    private boolean hasStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void refreshPermissionUi() {
        boolean ok = hasStorageAccess();
        permissionButton.setText(ok ? "Zugriff ✓" : "Zugriff");
        scanButton.setEnabled(ok && !scanning);
        if (!ok) status.setText("Für den vollständigen gemeinsamen Gerätespeicher ist eine einmalige Freigabe nötig.");
    }

    private void requestStorageAccess() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                Intent intent = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION));
            }
        } else {
            requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE}, 42);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshPermissionUi();
        resumePendingUpdateAfterPermission();
        checkCompletedPendingDownload();
    }

    @Override
    protected void onDestroy() {
        uiHandler.removeCallbacks(scanElapsedTicker);
        try { unregisterReceiver(updateDownloadReceiver); } catch (Exception ignored) { }
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        refreshPermissionUi();
    }

    private void startScan() {
        if (!hasStorageAccess()) {
            requestStorageAccess();
            return;
        }
        if (scanning) return;
        scanning = true;
        candidates.clear();
        displayRows.clear();
        list.clearChoices();
        adapter.notifyDataSetChanged();
        beginScanProgress();
        summary.setText("Dateien werden geprüft.");
        scanButton.setEnabled(false);
        deleteButton.setEnabled(false);
        autoCleanButton.setEnabled(false);
        reportButton.setEnabled(false);
        shareReportButton.setEnabled(false);

        new Thread(() -> {
            ScanState state = new ScanState();
            File root = Environment.getExternalStorageDirectory();

            setScanProgress(1, "1/8 Hauptscan des Gerätespeichers");
            scanTree(root, state);
            setScanProgress(24, "1/8 Hauptverzeichnis wird bewertet");
            auditStorageRoot(root, state);
            setScanProgress(26, "1/8 Leere Ordner werden sicher geprüft");
            findSafeEmptyDirectoryTrees(root, state);
            setScanProgress(27, "1/8 Hauptscan abgeschlossen");

            // Kontrolllauf speziell für Download.
            setScanProgress(28, "2/8 Download-Unterordner werden kontrolliert");
            File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
            auditDownloadTree(downloads, state, 0);
            setScanProgress(38, "2/8 Download-Kontrollscan abgeschlossen");

            // Androids Download-Index als zusätzlicher Fallback.
            setScanProgress(39, "3/8 Android-Download-Index wird geprüft");
            scanDownloadMediaStoreFallback(state);
            setScanProgress(45, "3/8 Android-Download-Index abgeschlossen");

            // Globaler Android-Dateiindex: findet insbesondere Archive, die
            // Xiaomi/Android im Dateimanager kennt, aber der File-Baum nicht sah.
            setScanProgress(46, "4/8 Globaler Android-Dateiindex · Archive");
            scanGlobalArchiveMediaStoreFallback(state);
            setScanProgress(55, "4/8 Zusätzliche Speicherbereiche werden gesucht");
            discoverAdditionalStorageRoots(state);
            scanAdditionalStorageRoots(state);
            setScanProgress(58, "4/8 Globaler Archivindex und Zusatzspeicher abgeschlossen");

            setScanProgress(59, "5/8 KC-/Projektstände werden ausgewertet");
            analyzeProjectDirectories(state);
            setScanProgress(75, "5/8 KC-/Projektstände ausgewertet");

            setScanProgress(76, "6/8 WhatsApp-Dubletten werden geprüft");
            findWhatsAppPhotoDuplicates(state);
            setScanProgress(84, "6/8 WhatsApp-Dubletten geprüft");

            setScanProgress(85, "7/8 Dateidubletten werden geprüft");
            findDuplicates(state);
            setScanProgress(94, "7/8 Dateidubletten geprüft");

            lastScanState = state;

            setScanProgress(95, "8/8 Treffer werden sortiert");
            Collections.sort(candidates, Comparator.comparingLong((Candidate c) -> c.size).reversed());
            setScanProgress(96, "8/8 Treffer werden vorbereitet");
            if (candidates.size() > MAX_VISIBLE) {
                candidates.subList(MAX_VISIBLE, candidates.size()).clear();
            }
            setScanProgress(97, "8/8 Treffer werden aufgelistet");

            runOnUiThread(() -> {
                displayRows.clear();
                int totalRows = candidates.size();
                int row = 0;
                for (Candidate c : candidates) {
                    displayRows.add(c.display(this));
                    row++;
                    if (totalRows > 0 && (row % 50 == 0 || row == totalRows)) {
                        scanProgressPercent = row == totalRows ? 99 : 98;
                        scanProgressPhase = "8/8 Treffer werden aufgelistet · " + row + "/" + totalRows;
                        renderScanProgress();
                    }
                }
                adapter.notifyDataSetChanged();
                scanning = false;
                scanButton.setEnabled(true);
                deleteButton.setEnabled(!candidates.isEmpty());
                updateAutoCleanButton();
                reportButton.setEnabled(!candidates.isEmpty());
                shareReportButton.setEnabled(!candidates.isEmpty());
                updateOverallSummary();
                finishScanProgress(state);
            });
        }).start();
    }

    static class ScanState {
        long files = 0;
        long dirs = 0;
        long totalBytes = 0;
        long archivesSeen = 0;
        long archiveBytesSeen = 0;
        long developmentArchivesSeen = 0;
        long developmentArchiveBytes = 0;
        long unreadableDirs = 0;
        long whatsappPhotosSeen = 0;
        long whatsappPhotoDuplicates = 0;
        long whatsappPhotoDuplicateBytes = 0;
        long nestedDuplicateFolders = 0;
        long nestedDuplicateFolderBytes = 0;
        long developmentDirsSeen = 0;
        long projectRootsSeen = 0;
        long possibleOldProjectDirs = 0;
        long possibleOldProjectBytes = 0;
        long verifiedContainedProjectDirs = 0;
        long verifiedContainedProjectBytes = 0;
        long projectDirsWithUniqueFiles = 0;
        long projectDirsWithDifferentFiles = 0;
        long unpackedKcProgramDirs = 0;
        long unpackedKcProgramBytes = 0;
        long safeEmptyDirectoryTrees = 0;
        long rootDirectoriesSeen = 0;
        long rootDirectoriesProtected = 0;
        long rootDirectoriesOccupied = 0;
        long rootDirectoriesSafeEmpty = 0;
        long rootDirectoriesSecondaryEmpty = 0;
        long rootDirectoriesUnreadable = 0;
        long downloadFilesSeen = 0;
        long downloadDirsSeen = 0;
        long downloadArchivesSeen = 0;
        long downloadAuditFiles = 0;
        long downloadAuditDirs = 0;
        long downloadAuditArchives = 0;
        long mediaStoreDownloadRows = 0;
        long mediaStoreFilesAdded = 0;
        long mediaStoreArchivesAdded = 0;
        long mediaStoreQueryErrors = 0;
        long mediaStoreGlobalRows = 0;
        long mediaStoreGlobalArchivesSeen = 0;
        long mediaStoreGlobalArchivesAdded = 0;
        long mediaStoreGlobalPathMisses = 0;
        long mediaStoreGlobalQueryErrors = 0;
        long additionalStorageRootsFound = 0;
        long additionalStorageRootsEnumerated = 0;
        long additionalStorageRootsScanned = 0;
        long additionalStorageRootsUnreadable = 0;
        long zipArchivesInspected = 0;
        long zipArchivesInvalid = 0;
        long zipArchivesEmpty = 0;
        boolean additionalStorageScanActive = false;
        int duplicateGroupSeq = 0;
        final Map<Long, List<File>> sameSize = new HashMap<>();
        final Map<Long, List<File>> whatsappPhotoSameSize = new HashMap<>();
        final Map<String, Long> archiveCountByExt = new HashMap<>();
        final List<ArchiveEntry> archives = new ArrayList<>();
        final Set<String> archivePaths = new HashSet<>();
        final List<File> projectDirCandidates = new ArrayList<>();
        final Set<String> projectDirPaths = new HashSet<>();
        final List<ProjectDirEntry> projectDirs = new ArrayList<>();
        final List<RootDirectoryEntry> rootDirectories = new ArrayList<>();
        final Map<String, FolderStats> folderStatsCache = new HashMap<>();
        final Map<String, String> fileHashCache = new HashMap<>();
        final Map<String, ArchiveInspection> archiveInspectionByPath = new HashMap<>();
        final Set<String> additionalStorageRootPaths = new HashSet<>();
        final Set<String> candidatePaths = new HashSet<>();
        final Set<String> seenFilePaths = new HashSet<>();
        final Set<String> inspectedProjectDirPaths = new HashSet<>();
    }

    static class FolderStats {
        long bytes = 0;
        int files = 0;
        int dirs = 0;
        long newestModified = 0;
    }

    static class FolderCompareResult {
        int matchedFiles = 0;
        int missingInReference = 0;
        int differentFiles = 0;
        int unreadableFiles = 0;
        long matchedBytes = 0;
        long missingBytes = 0;
        long differentBytes = 0;
        final List<String> missingSamples = new ArrayList<>();
        final List<String> differentSamples = new ArrayList<>();

        boolean fullyContained() {
            return missingInReference == 0 && differentFiles == 0 && unreadableFiles == 0;
        }
    }

    static class RootDirectoryEntry {
        final File dir;
        final String assessment;
        final int directItems;

        RootDirectoryEntry(File dir, String assessment, int directItems) {
            this.dir = dir;
            this.assessment = assessment;
            this.directItems = directItems;
        }
    }

    static class ProjectDirEntry {
        final File dir;
        final String key;
        final FolderStats stats;
        final int developmentDepth;
        String assessment;
        File reference;
        FolderCompareResult comparison;

        ProjectDirEntry(File dir, String key, FolderStats stats, int developmentDepth) {
            this.dir = dir;
            this.key = key;
            this.stats = stats;
            this.developmentDepth = developmentDepth;
            this.assessment = "INFO – Projektordner erkannt";
        }
    }

    static class ArchiveInspection {
        boolean valid = true;
        int entries = 0;
        int files = 0;
        long uncompressedBytes = 0;
        String error = null;
    }

    static class ArchiveEntry {
        final File file;
        final long size;
        final String ext;
        final String assessment;
        final ArchiveInspection inspection;

        ArchiveEntry(File file, long size, String ext, String assessment, ArchiveInspection inspection) {
            this.file = file;
            this.size = size;
            this.ext = ext;
            this.assessment = assessment;
            this.inspection = inspection;
        }
    }

    private void scanTree(File file, ScanState state) {
        if (file == null || !file.exists()) return;
        String path = file.getAbsolutePath();
        if (isExcludedPath(path)) return;

        if (file.isDirectory()) {
            state.dirs++;
            if (isDirectoryInDownloadTree(file)) state.downloadDirsSeen++;
            recordProjectDirCandidate(file, state);

            if (isNestedDuplicateProjectDir(file) && findTopUnpackedKcCleanupRoot(file) == null) {
                long sz = folderSize(file, 0);
                scanArchivesOnly(file, state, 0);
                state.nestedDuplicateFolders++;
                state.nestedDuplicateFolderBytes += sz;
                addCandidate(file, sz, Risk.YELLOW,
                        "Verschachtelter gleichnamiger Entwicklungsordner; wahrscheinlich kompletter doppelter Projektstand – vor Löschung prüfen", state);
                return;
            }

            String name = file.getName().toLowerCase(Locale.ROOT);
            if (GENERATED_DIRS.contains(name)) {
                long sz = folderSize(file, 0);
                scanArchivesOnly(file, state, 0);
                if (sz >= MB) addCandidate(file, sz, Risk.GREEN, "Erzeugter Entwicklungsordner; normalerweise wiederherstellbar", state);
                return; // normale Dateien nicht doppelt zählen; Archive werden diagnostisch erfasst
            }
            File[] children;
            try { children = file.listFiles(); } catch (SecurityException e) { state.unreadableDirs++; return; }
            if (children == null) { state.unreadableDirs++; return; }
            for (File child : children) scanTree(child, state);
        } else {
            registerScannedFile(file, state, false);
        }
    }

    private void registerScannedFile(File file, ScanState state, boolean supplemental) {
        if (file == null || state == null || !file.isFile()) return;
        String path = file.getAbsolutePath();
        if (isExcludedPath(path)) return;
        if (!state.seenFilePaths.add(path)) return;

        state.files++;
        long size = file.length();
        state.totalBytes += size;

        if (isInDownloadTree(file)) {
            state.downloadFilesSeen++;
            String ext = extension(file.getName().toLowerCase(Locale.ROOT));
            if (ARCHIVE_EXT.contains(ext)) state.downloadArchivesSeen++;
        }
        if (supplemental) state.mediaStoreFilesAdded++;

        if (size >= MB) state.sameSize.computeIfAbsent(size, k -> new ArrayList<>()).add(file);
        if (isWhatsAppPhoto(file)) {
            state.whatsappPhotosSeen++;
            if (size >= 64L * 1024L) {
                state.whatsappPhotoSameSize.computeIfAbsent(size, k -> new ArrayList<>()).add(file);
            }
        }
        classifyFile(file, size, state);
        if (!state.additionalStorageScanActive && state.files % 500 == 0) {
            long f = state.files;
            int pct = 2 + Math.min(24, (int) (f / 1200L));
            setScanProgress(pct, "1/8 Hauptscan · " + f + " Dateien geprüft");
        }
    }

    private void auditDownloadTree(File file, ScanState state, int depth) {
        if (file == null || state == null || !file.exists() || depth > 80) return;
        if (isExcludedPath(file.getAbsolutePath())) return;

        if (file.isDirectory()) {
            state.downloadAuditDirs++;
            File[] children;
            try { children = file.listFiles(); }
            catch (SecurityException e) { state.unreadableDirs++; return; }
            if (children == null) { state.unreadableDirs++; return; }
            for (File child : children) auditDownloadTree(child, state, depth + 1);
            return;
        }

        state.downloadAuditFiles++;
        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        if (ARCHIVE_EXT.contains(ext)) state.downloadAuditArchives++;

        // Nur bislang unbekannte Dateien müssen erneut klassifiziert werden.
        // Bereits im Hauptscan bekannte Dateien werden lediglich gezählt.
        if (!state.seenFilePaths.contains(file.getAbsolutePath())) {
            registerScannedFile(file, state, false);
        }

        if (state.downloadAuditFiles % 250 == 0) {
            long n = state.downloadAuditFiles;
            long a = state.downloadAuditArchives;
            long expected = Math.max(1L, state.downloadFilesSeen);
            int pct = 28 + (int) Math.min(10L, (10L * n) / expected);
            setScanProgress(pct, "2/8 Download-Kontrollscan · " + n +
                    " Dateien, " + a + " Archive");
        }
    }

    private void scanDownloadMediaStoreFallback(ScanState state) {
        if (state == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;

        Uri uri;
        try {
            uri = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        } catch (Exception e) {
            uri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
        }

        String[] projection = new String[] {
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.RELATIVE_PATH,
                MediaStore.MediaColumns.SIZE
        };

        try (Cursor cursor = getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor == null) {
                state.mediaStoreQueryErrors++;
                return;
            }

            int nameCol = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int relCol = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH);
            int mediaTotalRows = Math.max(1, cursor.getCount());
            while (cursor.moveToNext()) {
                state.mediaStoreDownloadRows++;
                if (state.mediaStoreDownloadRows % 250 == 0) {
                    long n = state.mediaStoreDownloadRows;
                    long added = state.mediaStoreFilesAdded;
                    int pct = 39 + (int) Math.min(6L,
                            (6L * state.mediaStoreDownloadRows) / mediaTotalRows);
                    setScanProgress(pct, "3/8 Android-Download-Index · " + n +
                            "/" + mediaTotalRows + " Einträge, " + added + " zusätzlich");
                }
                String name = nameCol >= 0 ? cursor.getString(nameCol) : null;
                String rel = relCol >= 0 ? cursor.getString(relCol) : null;
                if (name == null || name.trim().isEmpty()) continue;
                if (rel == null || rel.trim().isEmpty()) rel = Environment.DIRECTORY_DOWNLOADS + "/";

                File candidate = new File(Environment.getExternalStorageDirectory(), rel + name);
                if (!candidate.exists() || !candidate.isFile()) continue;
                if (isExcludedPath(candidate.getAbsolutePath())) continue;

                String ext = extension(candidate.getName().toLowerCase(Locale.ROOT));
                boolean archive = ARCHIVE_EXT.contains(ext);
                boolean wasSeen = state.seenFilePaths.contains(candidate.getAbsolutePath());
                registerScannedFile(candidate, state, true);
                if (archive && !wasSeen && state.archivePaths.contains(candidate.getAbsolutePath())) {
                    state.mediaStoreArchivesAdded++;
                }

                // Auch Elternordner bis Download mit prüfen, damit ausgepackte
                // KC-Projekte aus dem Index nicht verloren gehen.
                File parent = candidate.getParentFile();
                int hops = 0;
                while (parent != null && hops++ < 8 && isDirectoryInDownloadTree(parent)) {
                    recordProjectDirCandidate(parent, state);
                    parent = parent.getParentFile();
                }
            }
        } catch (Exception e) {
            state.mediaStoreQueryErrors++;
        }
    }

    private void scanGlobalArchiveMediaStoreFallback(ScanState state) {
        if (state == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return;

        Uri uri = MediaStore.Files.getContentUri("external");
        String[] projection = new String[] {
                MediaStore.Files.FileColumns.DATA,
                MediaStore.MediaColumns.DISPLAY_NAME,
                MediaStore.MediaColumns.RELATIVE_PATH,
                MediaStore.MediaColumns.SIZE
        };

        try (Cursor cursor = getContentResolver().query(uri, projection, null, null, null)) {
            if (cursor == null) {
                state.mediaStoreGlobalQueryErrors++;
                return;
            }

            int dataCol = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATA);
            int nameCol = cursor.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME);
            int relCol = cursor.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH);
            int total = Math.max(1, cursor.getCount());

            while (cursor.moveToNext()) {
                state.mediaStoreGlobalRows++;
                String name = nameCol >= 0 ? cursor.getString(nameCol) : null;
                if (name == null || name.trim().isEmpty()) continue;

                String data = dataCol >= 0 ? cursor.getString(dataCol) : null;
                String rel = relCol >= 0 ? cursor.getString(relCol) : null;
                rememberAdditionalStorageRoot(data, state);

                String ext = extension(name.toLowerCase(Locale.ROOT));
                if (!ARCHIVE_EXT.contains(ext)) {
                    if (state.mediaStoreGlobalRows % 1000 == 0) {
                        int pct = 46 + (int) Math.min(9L,
                                (9L * state.mediaStoreGlobalRows) / total);
                        setScanProgress(pct, "4/8 Globaler Dateiindex · " +
                                state.mediaStoreGlobalRows + "/" + total +
                                " Einträge · " + state.mediaStoreGlobalArchivesSeen + " Archive");
                    }
                    continue;
                }

                state.mediaStoreGlobalArchivesSeen++;
                File candidate = resolveIndexedFile(data, rel, name);
                if (candidate == null || !candidate.exists() || !candidate.isFile()) {
                    state.mediaStoreGlobalPathMisses++;
                    continue;
                }
                if (isExcludedPath(candidate.getAbsolutePath())) continue;

                boolean wasSeen = state.seenFilePaths.contains(candidate.getAbsolutePath());
                registerScannedFile(candidate, state, false);
                if (!wasSeen && state.archivePaths.contains(candidate.getAbsolutePath())) {
                    state.mediaStoreGlobalArchivesAdded++;
                }

                if (state.mediaStoreGlobalRows % 250 == 0) {
                    int pct = 46 + (int) Math.min(9L,
                            (9L * state.mediaStoreGlobalRows) / total);
                    setScanProgress(pct, "4/8 Globaler Dateiindex · " +
                            state.mediaStoreGlobalRows + "/" + total +
                            " Einträge · " + state.mediaStoreGlobalArchivesSeen +
                            " Archive · " + state.mediaStoreGlobalArchivesAdded + " zusätzlich");
                }
            }
        } catch (Exception e) {
            state.mediaStoreGlobalQueryErrors++;
        }
    }

    private List<File> listEmulatedStorageRoots() {
        List<File> roots = new ArrayList<>();
        Set<String> seen = new HashSet<>();

        File primary = Environment.getExternalStorageDirectory();
        if (primary != null && primary.exists() && primary.isDirectory()) {
            String p = primary.getAbsolutePath();
            if (seen.add(p)) roots.add(primary);
        }

        File emulated = primary != null ? primary.getParentFile() : new File("/storage/emulated");
        if (emulated != null && emulated.exists() && emulated.isDirectory()) {
            File[] children;
            try {
                children = emulated.listFiles();
            } catch (SecurityException e) {
                children = null;
            }
            if (children != null) {
                for (File child : children) {
                    if (child == null || !child.exists() || !child.isDirectory()) continue;
                    String name = child.getName() == null ? "" : child.getName();
                    if (!name.matches("[0-9]+")) continue;
                    String p = child.getAbsolutePath();
                    if (seen.add(p)) roots.add(child);
                }
            }
        }

        roots.sort(Comparator.comparing(a -> a.getAbsolutePath().toLowerCase(Locale.ROOT)));
        return roots;
    }

    private boolean isPrimarySharedStorage(File file) {
        if (file == null) return false;
        File root = emulatedStorageRootFor(file);
        File primary = Environment.getExternalStorageDirectory();
        return root != null && primary != null && samePath(root, primary);
    }

    private void discoverAdditionalStorageRoots(ScanState state) {
        if (state == null) return;
        for (File root : listEmulatedStorageRoots()) {
            if (root == null || !root.exists() || !root.isDirectory()) continue;
            if (isPrimarySharedStorage(root)) continue;

            state.additionalStorageRootsEnumerated++;
            String p = root.getAbsolutePath();
            if (state.additionalStorageRootPaths.add(p)) {
                state.additionalStorageRootsFound++;
            }
        }
    }

    private void rememberAdditionalStorageRoot(String absolutePath, ScanState state) {
        if (absolutePath == null || state == null) return;
        String p = absolutePath.replace('\\', '/');
        String prefix = "/storage/emulated/";
        if (!p.startsWith(prefix)) return;
        int slash = p.indexOf('/', prefix.length());
        if (slash < 0) return;

        String rootPath = p.substring(0, slash);
        File primary = Environment.getExternalStorageDirectory();
        if (primary != null && rootPath.equalsIgnoreCase(primary.getAbsolutePath().replace('\\', '/'))) return;

        if (state.additionalStorageRootPaths.add(rootPath)) {
            state.additionalStorageRootsFound++;
        }
    }

    private void scanAdditionalStorageRoots(ScanState state) {
        if (state == null || state.additionalStorageRootPaths.isEmpty()) return;
        List<String> roots = new ArrayList<>(state.additionalStorageRootPaths);
        Collections.sort(roots);

        state.additionalStorageScanActive = true;
        try {
            int doneCount = 0;
            for (String rootPath : roots) {
                doneCount++;
                setScanProgress(55 + Math.min(2, doneCount - 1),
                        "4/8 Zusatzspeicher " + doneCount + "/" + roots.size() + " · " + rootPath);
                File root = new File(rootPath);
                File[] direct;
                try {
                    direct = root.exists() && root.isDirectory() ? root.listFiles() : null;
                } catch (SecurityException e) {
                    direct = null;
                }
                if (direct == null) {
                    state.additionalStorageRootsUnreadable++;
                    continue;
                }

                state.additionalStorageRootsScanned++;
                scanTree(root, state);
                auditStorageRoot(root, state);
                findSafeEmptyDirectoryTrees(root, state);
            }
        } finally {
            state.additionalStorageScanActive = false;
        }
    }

    private File emulatedStorageRootFor(File file) {
        if (file == null) return null;
        String p = file.getAbsolutePath().replace('\\', '/');
        String prefix = "/storage/emulated/";
        if (!p.startsWith(prefix)) return null;
        int slash = p.indexOf('/', prefix.length());
        String rootPath = slash < 0 ? p : p.substring(0, slash);
        return new File(rootPath);
    }

    private boolean isExcludedPath(String path) {
        String p = path.replace('\\', '/');
        return p.contains("/Android/data") || p.contains("/Android/obb") || p.contains("/Android/.Trash");
    }

    private void auditStorageRoot(File root, ScanState state) {
        if (root == null || state == null || !root.exists() || !root.isDirectory()) return;

        File[] children;
        try {
            children = root.listFiles();
        } catch (SecurityException e) {
            state.rootDirectoriesUnreadable++;
            return;
        }
        if (children == null) {
            state.rootDirectoriesUnreadable++;
            return;
        }

        List<File> dirs = new ArrayList<>();
        for (File child : children) {
            if (child != null && child.isDirectory()) dirs.add(child);
        }
        dirs.sort(Comparator.comparing(a -> {
            String name = a.getName();
            return name == null ? "" : name.toLowerCase(Locale.ROOT);
        }));

        for (File dir : dirs) {
            state.rootDirectoriesSeen++;

            boolean protectedDir = isProtectedEmptyDirectoryPath(dir) || isEmptyCleanupTraversalBlocked(dir);
            File[] direct;
            try {
                direct = dir.listFiles();
            } catch (SecurityException e) {
                direct = null;
            }

            if (protectedDir) {
                state.rootDirectoriesProtected++;
                state.rootDirectories.add(new RootDirectoryEntry(
                        dir,
                        "GESCHÜTZT – System-/App-/Medienbereich; nicht automatisch löschen",
                        direct == null ? -1 : direct.length));
                continue;
            }

            if (direct == null) {
                state.rootDirectoriesUnreadable++;
                state.rootDirectories.add(new RootDirectoryEntry(
                        dir,
                        "NICHT LESBAR – vorsichtshalber geschützt behandeln",
                        -1));
                continue;
            }

            if (direct.length == 0) {
                if (isPrimarySharedStorage(dir)) {
                    state.rootDirectoriesSafeEmpty++;
                    state.rootDirectories.add(new RootDirectoryEntry(
                            dir,
                            "LEER – sicher löschbar; wird vor dem Löschen erneut geprüft",
                            0));
                } else {
                    state.rootDirectoriesSecondaryEmpty++;
                    state.rootDirectories.add(new RootDirectoryEntry(
                            dir,
                            "LEER – zusätzliches Android-Speicherprofil; nur manuell prüfen, nicht automatisch löschen",
                            0));
                }
            } else {
                state.rootDirectoriesOccupied++;
                state.rootDirectories.add(new RootDirectoryEntry(
                        dir,
                        "BELEGT – enthält Daten; nicht automatisch löschen",
                        direct.length));
            }
        }
    }

    private void findSafeEmptyDirectoryTrees(File root, ScanState state) {
        if (root == null || state == null || !root.exists() || !root.isDirectory()) return;

        List<File> allSafeEmpty = new ArrayList<>();
        collectSafeEmptyDirectoryTrees(root, allSafeEmpty, 0);
        allSafeEmpty.sort(Comparator.comparingInt(a -> a.getAbsolutePath().length()));

        List<File> selectedRoots = new ArrayList<>();
        for (File dir : allSafeEmpty) {
            boolean covered = false;
            for (File parent : selectedRoots) {
                if (samePath(dir, parent) || isDescendantOf(dir, parent)) {
                    covered = true;
                    break;
                }
            }
            if (covered) continue;

            selectedRoots.add(dir);
            String p = dir.getAbsolutePath();
            if (!state.candidatePaths.contains(p)) {
                if (isPrimarySharedStorage(dir)) {
                    addCandidate(dir, 0L, Risk.GREEN,
                            "Leerer Ordnerbaum außerhalb geschützter System-/App-Bereiche; sicher automatisch löschbar", state);
                    state.safeEmptyDirectoryTrees++;
                } else {
                    addCandidate(dir, 0L, Risk.YELLOW,
                            "Leerer Ordnerbaum in zusätzlichem Android-Speicherprofil; erkannt, aber nicht automatisch löschen", state);
                }
            }
        }
    }

    private boolean collectSafeEmptyDirectoryTrees(File dir, List<File> safeEmpty, int depth) {
        if (dir == null || safeEmpty == null || !dir.exists() || !dir.isDirectory() || depth > 80) return false;
        if (isExcludedPath(dir.getAbsolutePath())) return false;
        if (isEmptyCleanupTraversalBlocked(dir)) return false;

        File[] children;
        try {
            children = dir.listFiles();
        } catch (SecurityException e) {
            return false;
        }
        if (children == null) return false;

        boolean treeHasNoFiles = true;
        for (File child : children) {
            if (child == null) {
                treeHasNoFiles = false;
                continue;
            }
            if (child.isFile()) {
                treeHasNoFiles = false;
            } else if (child.isDirectory()) {
                if (!collectSafeEmptyDirectoryTrees(child, safeEmpty, depth + 1)) {
                    treeHasNoFiles = false;
                }
            } else {
                treeHasNoFiles = false;
            }
        }

        if (treeHasNoFiles && !isProtectedEmptyDirectoryPath(dir)) {
            safeEmpty.add(dir);
        }
        return treeHasNoFiles;
    }

    private boolean isProtectedEmptyDirectoryPath(File dir) {
        if (dir == null) return true;
        File root = emulatedStorageRootFor(dir);
        if (root == null) return true;
        if (samePath(dir, root)) return true;
        if (isEmptyCleanupTraversalBlocked(dir)) return true;

        String rootPath = root.getAbsolutePath().replace('\\', '/');
        String path = dir.getAbsolutePath().replace('\\', '/');
        if (!path.startsWith(rootPath + "/")) return true;
        String rel = path.substring(rootPath.length() + 1).toLowerCase(Locale.ROOT);

        if (rel.equals("download") || rel.equals("downloads")) return true;

        // Xiaomi-Systemcontainer bleibt geschützt. Wirklich leere Unterordner
        // darin dürfen separat geprüft und entfernt werden.
        return rel.equals("download/downloaded_rom") || rel.equals("downloads/downloaded_rom");
    }

    private boolean isEmptyCleanupTraversalBlocked(File dir) {
        if (dir == null) return true;
        File root = emulatedStorageRootFor(dir);
        if (root == null) return true;

        String rootPath = root.getAbsolutePath().replace('\\', '/');
        String path = dir.getAbsolutePath().replace('\\', '/');
        if (!path.equals(rootPath) && !path.startsWith(rootPath + "/")) return true;
        if (path.equals(rootPath)) return false;

        String rel = path.substring(rootPath.length() + 1);
        String[] parts = rel.split("/");
        for (String part : parts) {
            if (part == null || part.isEmpty()) continue;
            if (part.startsWith(".")) return true;
        }

        String top = parts.length == 0 ? "" : parts[0].toLowerCase(Locale.ROOT);
        if (top.equals("android") ||
                top.equals("dcim") ||
                top.equals("pictures") ||
                top.equals("movies") ||
                top.equals("music") ||
                top.equals("documents") ||
                top.equals("ringtones") ||
                top.equals("notifications") ||
                top.equals("podcasts") ||
                top.equals("alarms") ||
                top.equals("recordings") ||
                top.equals("whatsapp") ||
                top.equals("miui") ||
                top.equals("xiaomi") ||
                top.equals("bluetooth") ||
                top.equals("lost.dir") ||
                top.equals("system volume information")) {
            return true;
        }

        // downloaded_rom selbst wird in isProtectedEmptyDirectoryPath geschützt.
        // Die Traversierung darf weiterlaufen, damit ausschließlich wirklich
        // leere Unterordner separat erkannt werden.

        // Paketnamenartige Hauptordner werden als App-Struktur behandelt.
        return top.matches("[a-z0-9_]+(\\.[a-z0-9_]+){2,}");
    }

    private boolean isDirectoryTreeStillEmptyAndSafe(File dir, int depth) {
        if (dir == null || !dir.exists() || !dir.isDirectory() || depth > 80) return false;
        if (isProtectedEmptyDirectoryPath(dir) || isEmptyCleanupTraversalBlocked(dir)) return false;

        File[] children;
        try {
            children = dir.listFiles();
        } catch (SecurityException e) {
            return false;
        }
        if (children == null) return false;
        for (File child : children) {
            if (child == null) return false;
            if (child.isFile()) return false;
            if (!child.isDirectory() || !isDirectoryTreeStillEmptyAndSafe(child, depth + 1)) return false;
        }
        return true;
    }

    private boolean isEmptyDirectoryCleanupCandidate(Candidate c) {
        return c != null && c.file != null && c.file.isDirectory() &&
                c.reason != null && c.reason.startsWith("Leerer Ordnerbaum außerhalb geschützter System-/App-Bereiche");
    }

    private void recordProjectDirCandidate(File dir, ScanState state) {
        if (dir == null || state == null || !dir.isDirectory()) return;

        // Derselbe Ordner kann über Hauptscan, Download-Kontrollscan und MediaStore
        // mehrfach auftauchen. Teure Marker-/listFiles-Prüfung nur einmal ausführen.
        String inspectedPath = dir.getAbsolutePath();
        if (!state.inspectedProjectDirPaths.add(inspectedPath)) return;

        int devDepth = developmentDepth(dir);
        if (devDepth >= 0) state.developmentDirsSeen++;

        String name = dir.getName() == null ? "" : dir.getName();
        boolean versionLike = isVersionLikeProjectName(name);
        boolean nestedDuplicate = isNestedDuplicateProjectDir(dir);
        boolean strongProjectName = isStrongProjectName(name);
        boolean inDownload = isDirectoryInDownloadTree(dir);
        boolean projectMarkers = inDownload && hasProjectMarkers(dir);
        int dlDepth = downloadDepth(dir);

        // Für die auf diesem Gerät nicht benötigten KC-Programmstände nur den
        // obersten entpackten Hauptordner erfassen. Unterordner wie kasse-git
        // und pc-manager dürfen denselben Speicher nicht noch einmal zählen.
        File cleanupRoot = findTopUnpackedKcCleanupRoot(dir);
        if (cleanupRoot != null && !samePath(dir, cleanupRoot)) return;

        boolean projectRoot = false;
        if (cleanupRoot != null) {
            projectRoot = true;
        } else if (devDepth == 1 && (strongProjectName || versionLike || projectMarkers)) {
            projectRoot = true; // direkter echter Projektstand unter Entwicklung/Projekte
        } else if (devDepth >= 2 && devDepth <= 8 &&
                (nestedDuplicate || (strongProjectName && (versionLike || projectMarkers)))) {
            projectRoot = true; // tiefe KC-/Versions-/Kopie-Stände
        } else if (inDownload && strongProjectName &&
                (versionLike || projectMarkers || (dlDepth >= 1 && dlDepth <= 3))) {
            projectRoot = true; // ausgepackte KC-Projekte auch ohne Versionswort
        } else if (inDownload && projectMarkers && versionLike && dlDepth >= 1 && dlDepth <= 4) {
            projectRoot = true;
        }

        if (!projectRoot) return;
        String path = dir.getAbsolutePath();
        if (state.projectDirPaths.add(path)) state.projectDirCandidates.add(dir);
    }

    private boolean isDirectoryInDownloadTree(File dir) {
        if (dir == null || !dir.isDirectory()) return false;
        String p = dir.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        return p.matches("^/storage/emulated/[^/]+/downloads?(?:/.*)?$");
    }

    private int downloadDepth(File dir) {
        if (dir == null) return -1;
        File current = dir;
        int depth = 0;
        while (current != null && depth <= 30) {
            String name = current.getName() == null ? "" : current.getName();
            File root = emulatedStorageRootFor(current);
            if ((name.equalsIgnoreCase("Download") || name.equalsIgnoreCase("Downloads")) &&
                    current.getParentFile() != null && root != null &&
                    samePath(current.getParentFile(), root)) {
                return depth;
            }
            current = current.getParentFile();
            depth++;
        }
        return -1;
    }

    private boolean hasProjectMarkers(File dir) {
        if (dir == null || !dir.isDirectory()) return false;
        File[] children;
        try { children = dir.listFiles(); } catch (SecurityException e) { return false; }
        if (children == null) return false;

        int inspected = 0;
        for (File child : children) {
            if (child == null) continue;
            String n = child.getName() == null ? "" : child.getName().toLowerCase(Locale.ROOT);
            if (child.isFile()) {
                if (n.equals("package.json") || n.equals("build.gradle") || n.equals("settings.gradle") ||
                        n.equals("gradlew") || n.equals("gradlew.bat") || n.equals("pom.xml") ||
                        n.equals("pyproject.toml") || n.equals("requirements.txt") ||
                        n.equals("pubspec.yaml") || n.equals("cargo.toml") ||
                        n.equals("composer.json") || n.equals("index.html")) {
                    return true;
                }
            } else if (child.isDirectory()) {
                if (n.equals(".git") || n.equals("src") || n.equals("app") ||
                        n.equals("backend") || n.equals("frontend")) {
                    return true;
                }
            }
            if (++inspected >= 250) break;
        }
        return false;
    }

    private int developmentDepth(File dir) {
        if (dir == null) return -1;
        File current = dir;
        int depth = 0;
        while (current != null && depth <= 12) {
            if (isDevelopmentAnchorName(current.getName())) return depth;
            current = current.getParentFile();
            depth++;
        }
        return -1;
    }

    private boolean isDevelopmentAnchorName(String raw) {
        String n = normalizeProjectToken(raw);
        return n.equals("entwicklung") || n.startsWith("entwicklung ") ||
                n.equals("development") || n.startsWith("development ") ||
                n.equals("projekte") || n.equals("projects") || n.equals("project") ||
                n.equals("dev") || n.equals("orbit") || n.equals("github") ||
                n.equals("quellcode") || n.equals("source");
    }

    private boolean isStrongProjectName(String raw) {
        String n = normalizeProjectToken(raw).replace(" ", "");
        return n.startsWith("kc") || n.contains("marktkasse") || n.contains("kasse") ||
                n.contains("dienstplan") || n.contains("dp2") || n.contains("dp3") ||
                n.contains("futura") || n.contains("verwaltung") || n.contains("manager") ||
                n.contains("moneybutler") || n.contains("kommunikation") || n.contains("communication") ||
                n.contains("framework") || n.contains("bilderrechner") ||
                n.contains("speichercheck") || n.contains("systemcheck") ||
                n.contains("inventar") || n.contains("weihnachtsmarkt");
    }

    private String unpackedKcCleanupKind(File dir) {
        if (dir == null || !dir.isDirectory() || !isDirectoryInDownloadTree(dir)) return null;
        String n = normalizeProjectToken(dir.getName()).replace(" ", "");

        if (n.contains("kcverwaltung") || n.equals("verwaltung") || n.startsWith("verwaltungv")) {
            return "KC Verwaltung";
        }
        if (n.contains("moneybutler") || n.contains("kcmoneybutler")) {
            return "Money Butler";
        }
        if (n.contains("marktkasse") || n.equals("kasse") || n.startsWith("kassegit")) {
            return "Kasse/MarktKasse";
        }
        if (n.contains("pcmanager") || n.equals("kcmanager") || n.startsWith("kcmanagerv")) {
            return "PC Manager";
        }
        return null;
    }

    private boolean hasProjectMarkersWithin(File dir, int depth) {
        if (dir == null || !dir.isDirectory() || depth < 0) return false;
        if (hasProjectMarkers(dir)) return true;
        if (depth == 0) return false;

        File[] children;
        try { children = dir.listFiles(); } catch (SecurityException e) { return false; }
        if (children == null) return false;

        int inspected = 0;
        for (File child : children) {
            if (child != null && child.isDirectory()) {
                String n = child.getName() == null ? "" : child.getName().toLowerCase(Locale.ROOT);
                if (!GENERATED_DIRS.contains(n) && hasProjectMarkersWithin(child, depth - 1)) return true;
            }
            if (++inspected >= 120) break;
        }
        return false;
    }

    private boolean isUnpackedKcCleanupRoot(File dir) {
        String kind = unpackedKcCleanupKind(dir);
        if (kind == null) return false;

        // Ein bloßer Ordnername wie "Kasse" reicht nicht. Es muss zusätzlich
        // nach Entwicklungs-/Versionsstand aussehen oder Projektmarker enthalten.
        return isVersionLikeProjectName(dir.getName()) ||
                developmentDepth(dir) >= 0 ||
                hasProjectMarkersWithin(dir, 2);
    }

    private File findTopUnpackedKcCleanupRoot(File dir) {
        if (dir == null || !dir.isDirectory() || !isDirectoryInDownloadTree(dir)) return null;
        File top = null;
        File current = dir;
        int hops = 0;
        while (current != null && hops++ < 12 && isDirectoryInDownloadTree(current)) {
            if (isUnpackedKcCleanupRoot(current)) top = current;
            File parent = current.getParentFile();
            if (parent == null || !isDirectoryInDownloadTree(parent)) break;
            current = parent;
        }
        return top;
    }

    private boolean samePath(File a, File b) {
        return a != null && b != null &&
                a.getAbsolutePath().replace('\\', '/').equalsIgnoreCase(
                        b.getAbsolutePath().replace('\\', '/'));
    }

    private String cachedSha256(File file, ScanState state) {
        if (file == null || state == null || !file.isFile()) return null;
        String key = file.getAbsolutePath() + "|" + file.length() + "|" + file.lastModified();
        String cached = state.fileHashCache.get(key);
        if (cached != null) return cached;
        String hash = sha256(file);
        if (hash != null) state.fileHashCache.put(key, hash);
        return hash;
    }

    private FolderCompareResult compareProjectDirectory(File candidateRoot, File referenceRoot, ScanState state) {
        FolderCompareResult out = new FolderCompareResult();
        if (candidateRoot == null || referenceRoot == null ||
                !candidateRoot.isDirectory() || !referenceRoot.isDirectory()) {
            out.unreadableFiles++;
            return out;
        }
        compareProjectTree(candidateRoot, candidateRoot, referenceRoot, state, out, 0);
        return out;
    }

    private void compareProjectTree(File root, File current, File referenceRoot,
                                    ScanState state, FolderCompareResult out, int depth) {
        if (current == null || out == null || depth > 60) {
            if (out != null) out.unreadableFiles++;
            return;
        }
        if (isExcludedPath(current.getAbsolutePath())) {
            out.unreadableFiles++;
            return;
        }
        if (current.isDirectory()) {
            File[] children;
            try {
                children = current.listFiles();
            } catch (SecurityException e) {
                out.unreadableFiles++;
                return;
            }
            if (children == null) {
                out.unreadableFiles++;
                return;
            }
            for (File child : children) {
                compareProjectTree(root, child, referenceRoot, state, out, depth + 1);
            }
            return;
        }
        if (!current.isFile()) return;

        String rootPath = root.getAbsolutePath();
        String currentPath = current.getAbsolutePath();
        if (!currentPath.startsWith(rootPath + File.separator)) {
            out.unreadableFiles++;
            return;
        }
        String relative = currentPath.substring(rootPath.length() + 1);
        File referenceFile = new File(referenceRoot, relative);

        if (!referenceFile.exists()) {
            out.missingInReference++;
            out.missingBytes += current.length();
            if (out.missingSamples.size() < 5) out.missingSamples.add(relative);
            return;
        }
        if (!referenceFile.isFile() || referenceFile.length() != current.length()) {
            out.differentFiles++;
            out.differentBytes += current.length();
            if (out.differentSamples.size() < 5) out.differentSamples.add(relative);
            return;
        }

        String a = cachedSha256(current, state);
        String b = cachedSha256(referenceFile, state);
        if (a == null || b == null) {
            out.unreadableFiles++;
        } else if (a.equalsIgnoreCase(b)) {
            out.matchedFiles++;
            out.matchedBytes += current.length();
        } else {
            out.differentFiles++;
            out.differentBytes += current.length();
            if (out.differentSamples.size() < 5) out.differentSamples.add(relative);
        }
    }

    private boolean isVersionLikeProjectName(String raw) {
        if (raw == null) return false;
        String n = raw.toLowerCase(Locale.ROOT).trim();
        return n.matches(".*\\bv[0-9]+([._-][0-9]+)*\\b.*") ||
                n.matches(".*20[0-9]{2}[-_.][0-9]{1,2}[-_.][0-9]{1,2}.*") ||
                n.matches(".*[0-9]{1,2}[-_.][0-9]{1,2}[-_.]20[0-9]{2}.*") ||
                n.matches(".*\\([0-9]+\\).*") ||
                n.matches(".*[-_ ]copy([0-9]*)?$") ||
                n.matches(".*[-_ ]kopie([0-9]*)?$") ||
                n.contains("backup") || n.contains("sicherung") || n.contains("_old") ||
                n.contains("-old") || n.contains(" alt") || n.contains("_alt") ||
                n.contains("_fixed") || n.contains("-fixed") || n.contains(" fixed") ||
                n.contains("_final") || n.contains("-final") || n.contains(" final") ||
                n.contains("komplett") || n.contains("zusammengefuehrt") ||
                n.contains("zusammengeführt") || n.contains("stand ");
    }

    private String normalizeProjectToken(String raw) {
        if (raw == null) return "";
        return raw.toLowerCase(Locale.ROOT)
                .replace('ä', 'a').replace('ö', 'o').replace('ü', 'u').replace('ß', 's')
                .replaceAll("[^a-z0-9]+", " ")
                .trim().replaceAll("\\s+", " ");
    }

    private String projectGroupKey(String raw) {
        String n = normalizeProjectToken(raw);

        // Bei Namen wie framework_studio_v1_38_7_... ist der stabile
        // Projektname der Teil VOR der Versionsnummer. So werden verschiedene
        // 1.38.x-Stände tatsächlich miteinander verglichen.
        String[] versionSplit = n.split("\\bv[0-9]+(?:[ ]+[0-9]+)*\\b", 2);
        if (versionSplit.length > 1) {
            String prefix = versionSplit[0].replaceAll("\\s+", " ").trim();
            int words = prefix.isEmpty() ? 0 : prefix.split(" ").length;
            if (prefix.length() >= 3 && words <= 4 && !prefix.matches(".*\\b20[0-9]{2}\\b.*")) {
                return prefix;
            }
        }

        n = n.replaceAll("\\b20[0-9]{2}[ ]+[0-9]{1,2}[ ]+[0-9]{1,2}\\b", " ");
        n = n.replaceAll("\\b[0-9]{1,2}[ ]+[0-9]{1,2}[ ]+20[0-9]{2}\\b", " ");
        n = n.replaceAll("\\bv[0-9]+(?:[ ]+[0-9]+)*\\b", " ");
        n = n.replaceAll("\\b(copy|kopie|backup|sicherung|old|alt|fixed|final|komplett|zusammengefuehrt|zusammengefuhrt)\\b", " ");
        n = n.replaceAll("\\bstand[ ]*[0-9]*\\b", " ");
        if (raw != null && raw.toLowerCase(Locale.ROOT).matches(".*(\\([0-9]+\\)|[-_ ][0-9]+)$")) {
            n = n.replaceAll("\\b[0-9]+\\b$", " ");
        }
        n = n.replaceAll("\\s+", " ").trim();
        if (n.length() < 3) n = normalizeProjectToken(raw);
        return n;
    }

    private FolderStats folderStats(File file, ScanState state, int depth) {
        FolderStats empty = new FolderStats();
        if (file == null || !file.exists() || depth > 50 || isExcludedPath(file.getAbsolutePath())) return empty;

        String key = file.getAbsolutePath();
        FolderStats cached = state.folderStatsCache.get(key);
        if (cached != null) return cached;

        FolderStats out = new FolderStats();
        out.newestModified = Math.max(0L, file.lastModified());
        if (file.isFile()) {
            out.bytes = file.length();
            out.files = 1;
            state.folderStatsCache.put(key, out);
            return out;
        }

        out.dirs = 1;
        File[] children;
        try { children = file.listFiles(); } catch (SecurityException e) { return out; }
        if (children != null) {
            for (File child : children) {
                FolderStats c = folderStats(child, state, depth + 1);
                out.bytes += c.bytes;
                out.files += c.files;
                out.dirs += c.dirs;
                out.newestModified = Math.max(out.newestModified, c.newestModified);
            }
        }
        state.folderStatsCache.put(key, out);
        return out;
    }

    private boolean isDescendantOf(File child, File parent) {
        if (child == null || parent == null) return false;
        String c = child.getAbsolutePath().replace('\\', '/');
        String p = parent.getAbsolutePath().replace('\\', '/');
        return !c.equals(p) && c.startsWith(p + "/");
    }

    private ProjectDirEntry chooseProjectReference(List<ProjectDirEntry> group) {
        ProjectDirEntry best = null;
        for (ProjectDirEntry e : group) {
            boolean nestedInsideGroup = false;
            for (ProjectDirEntry other : group) {
                if (other != e && isDescendantOf(e.dir, other.dir)) {
                    nestedInsideGroup = true;
                    break;
                }
            }
            if (best == null) {
                best = e;
                continue;
            }
            boolean bestNested = false;
            for (ProjectDirEntry other : group) {
                if (other != best && isDescendantOf(best.dir, other.dir)) {
                    bestNested = true;
                    break;
                }
            }
            if (bestNested && !nestedInsideGroup) {
                best = e;
            } else if (bestNested == nestedInsideGroup &&
                    e.stats.newestModified > best.stats.newestModified) {
                best = e;
            }
        }
        return best;
    }

    private void analyzeProjectDirectories(ScanState state) {
        if (state == null || state.projectDirCandidates.isEmpty()) return;

        Map<String, List<ProjectDirEntry>> groups = new HashMap<>();
        int analyzed = 0;
        int total = state.projectDirCandidates.size();
        for (File dir : state.projectDirCandidates) {
            analyzed++;
            if (analyzed == 1 || analyzed % 5 == 0 || analyzed == total) {
                final int done = analyzed;
                int pct = 59 + (int) ((16L * done) / Math.max(1, total));
                setScanProgress(pct, "5/8 KC-/Projektstände · " + done + "/" + total);
            }
            FolderStats stats = folderStats(dir, state, 0);
            File cleanupRoot = findTopUnpackedKcCleanupRoot(dir);
            String cleanupKind = cleanupRoot != null && samePath(dir, cleanupRoot)
                    ? unpackedKcCleanupKind(dir) : null;
            String key = cleanupKind != null ? normalizeProjectToken(cleanupKind) : projectGroupKey(dir.getName());
            ProjectDirEntry entry = new ProjectDirEntry(dir, key, stats, developmentDepth(dir));
            state.projectDirs.add(entry);
            state.projectRootsSeen++;

            if (stats.files == 0 && stats.bytes == 0 && isDirectoryTreeStillEmptyAndSafe(dir, 0)) {
                entry.assessment = "LOESCHBAR – leerer Projekt-/Versionsordner; keine Dateien enthalten";
                boolean alreadyKnown = state.candidatePaths.contains(dir.getAbsolutePath());
                addCandidate(dir, 0L, Risk.GREEN,
                        "Leerer Ordnerbaum außerhalb geschützter System-/App-Bereiche; sicher automatisch löschbar",
                        state);
                if (!alreadyKnown) state.safeEmptyDirectoryTrees++;
                continue;
            }

            if (cleanupKind != null) {
                entry.assessment = "LOESCHBAR – entpackter " + cleanupKind +
                        "-Programmstand im Download-Baum; nur oberster Hauptordner wird gezählt";
                state.unpackedKcProgramDirs++;
                state.unpackedKcProgramBytes += stats.bytes;
                addCandidate(dir, stats.bytes, Risk.GREEN,
                        "Entpackter KC-Programmordner im Download-Baum (" + cleanupKind +
                                "); Download-/Entwicklungsstand – kompletter Hauptordner zum Löschen freigegeben",
                        state);
                continue;
            }

            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(entry);
        }

        for (List<ProjectDirEntry> group : groups.values()) {
            if (group.isEmpty()) continue;
            ProjectDirEntry keep = chooseProjectReference(group);

            if (group.size() == 1) {
                ProjectDirEntry e = group.get(0);
                if (isVersionLikeProjectName(e.dir.getName())) {
                    e.assessment = "INFO – einzelner Versions-/Kopieordner; kein paralleler Vergleichsstand erkannt";
                } else {
                    e.assessment = "BEHALTEN – einzelner erkannter Projektstand";
                }
                continue;
            }

            keep.assessment = "REFERENZ – bevorzugter Stand innerhalb dieser Projektgruppe";
            for (ProjectDirEntry e : group) {
                if (e == keep) continue;
                e.reference = keep.dir;
                state.possibleOldProjectDirs++;
                state.possibleOldProjectBytes += e.stats.bytes;

                if (isDescendantOf(keep.dir, e.dir)) {
                    e.assessment = "SCHUETZEN – Referenz liegt innerhalb dieses Ordners; automatische Löschung gesperrt";
                    addCandidate(e.dir, e.stats.bytes, Risk.RED,
                            "Projektstand enthält den Referenzordner; automatische Löschung wäre unsicher",
                            keep.dir, 0, state);
                    state.projectDirsWithDifferentFiles++;
                    continue;
                }

                setScanPhase("5/8 Projektvergleich per SHA-256 · " + e.dir.getName());
                FolderCompareResult cmp = compareProjectDirectory(e.dir, keep.dir, state);
                e.comparison = cmp;

                if (cmp.fullyContained()) {
                    e.assessment = "LOESCHBAR – vollständig bytegleich im Referenzstand enthalten";
                    state.verifiedContainedProjectDirs++;
                    state.verifiedContainedProjectBytes += e.stats.bytes;
                    addCandidate(e.dir, e.stats.bytes, Risk.GREEN,
                            "Alter Projektstand vollständig bytegleich im Referenzordner enthalten; " +
                                    cmp.matchedFiles + " Dateien geprüft",
                            keep.dir, 0, state);
                } else if (cmp.differentFiles > 0 || cmp.unreadableFiles > 0) {
                    e.assessment = "SCHUETZEN – echte Inhaltsabweichung oder nicht vollständig prüfbar";
                    state.projectDirsWithDifferentFiles++;
                    addCandidate(e.dir, e.stats.bytes, Risk.RED,
                            "Projektstand weicht vom Referenzordner ab: " +
                                    cmp.differentFiles + " unterschiedliche, " +
                                    cmp.missingInReference + " nur hier vorhandene, " +
                                    cmp.unreadableFiles + " nicht prüfbare Dateien",
                            keep.dir, 0, state);
                } else {
                    e.assessment = "PRUEFEN – zusätzliche Dateien fehlen im Referenzstand";
                    state.projectDirsWithUniqueFiles++;
                    addCandidate(e.dir, e.stats.bytes, Risk.YELLOW,
                            "Projektstand enthält " + cmp.missingInReference +
                                    " Datei(en), die im Referenzordner fehlen; nicht automatisch löschen",
                            keep.dir, 0, state);
                }
            }
        }

        state.projectDirs.sort((a, b) -> {
            int k = a.key.compareToIgnoreCase(b.key);
            if (k != 0) return k;
            return Long.compare(b.stats.newestModified, a.stats.newestModified);
        });
    }

    private void scanArchivesOnly(File file, ScanState state, int depth) {
        if (file == null || !file.exists() || depth > 40) return;
        if (isExcludedPath(file.getAbsolutePath())) return;

        if (file.isDirectory()) {
            File[] children;
            try { children = file.listFiles(); } catch (SecurityException e) { state.unreadableDirs++; return; }
            if (children == null) { state.unreadableDirs++; return; }
            for (File child : children) scanArchivesOnly(child, state, depth + 1);
            return;
        }

        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        if (ARCHIVE_EXT.contains(ext)) recordArchive(file, file.length(), state);
    }

    private void recordArchive(File file, long size, ScanState state) {
        if (file == null || state == null) return;
        String path = file.getAbsolutePath();
        if (!state.archivePaths.add(path)) return;

        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        state.archivesSeen++;
        state.archiveBytesSeen += size;
        state.archiveCountByExt.put(ext, state.archiveCountByExt.getOrDefault(ext, 0L) + 1L);

        ArchiveInspection inspection = null;
        if (ext.equals("zip")) {
            inspection = inspectZipArchive(file, state);
            state.archiveInspectionByPath.put(path, inspection);
        }
        state.archives.add(new ArchiveEntry(file, size, ext,
                archiveAssessment(file, size, inspection), inspection));
    }

    private ArchiveInspection inspectZipArchive(File file, ScanState state) {
        ArchiveInspection out = new ArchiveInspection();
        if (state != null) state.zipArchivesInspected++;
        try (ZipFile zip = new ZipFile(file)) {
            java.util.Enumeration<? extends ZipEntry> entries = zip.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                out.entries++;
                if (!entry.isDirectory()) {
                    out.files++;
                    long s = entry.getSize();
                    if (s > 0) out.uncompressedBytes += s;
                }
            }
            if (out.files == 0 && state != null) state.zipArchivesEmpty++;
        } catch (Exception e) {
            out.valid = false;
            out.error = e.getClass().getSimpleName();
            if (state != null) state.zipArchivesInvalid++;
        }
        return out;
    }

    private String archiveAssessment(File file, long size, ArchiveInspection inspection) {
        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        long age = System.currentTimeMillis() - file.lastModified();

        if (inspection != null && !inspection.valid) {
            return "PRUEFEN – ZIP nicht lesbar oder beschädigt; nicht automatisch löschen";
        }
        if (inspection != null && inspection.files == 0) {
            return "PRUEFEN – ZIP gültig, enthält aber keine Dateien";
        }
        if (ext.equals("apk") || ext.equals("aab")) {
            return "GESCHUETZT – APK/AAB wird nicht automatisch gelöscht";
        }
        if (isKcDevelopmentArchive(file)) {
            if (isInDownloadTree(file)) {
                return age >= RECENT_ARCHIVE_PROTECTION
                        ? "LOESCHBAR – altes KC-/Entwicklungsarchiv im Download-Baum"
                        : "GESCHUETZT – frisch heruntergeladenes Entwicklungsarchiv";
            }
            return "PRUEFEN – KC-/Entwicklungsarchiv außerhalb des Download-Baums";
        }
        if (isAutoCleanupArchiveExtension(ext) && age > 14 * DAY && isDirectDownloadFile(file)) {
            return "LOESCHBAR – altes Archiv direkt im Download-Ordner (>14 Tage)";
        }
        if (isAutoCleanupArchiveExtension(ext) && age > 14 * DAY && size >= MB) {
            return "PRUEFEN – altes Archiv außerhalb des direkten Download-Ordners (>14 Tage)";
        }
        return "BEHALTEN – keine sichere automatische Löschregel erfüllt";
    }

    private void classifyFile(File file, long size, ScanState state) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        String ext = extension(name);
        long age = System.currentTimeMillis() - file.lastModified();
        String path = file.getAbsolutePath().toLowerCase(Locale.ROOT);
        boolean devPath = path.contains("github") || path.contains("gitlab") || path.contains("project") || path.contains("projekte") ||
                path.contains("entwicklung") || path.contains("development") || path.contains("source") || path.contains("src") || path.contains("build");

        if (ARCHIVE_EXT.contains(ext)) {
            recordArchive(file, size, state);
        }

        if (ext.equals("zip")) {
            ArchiveInspection inspection = state.archiveInspectionByPath.get(file.getAbsolutePath());
            if (inspection != null && (!inspection.valid || inspection.files == 0)) {
                addCandidate(file, size, Risk.YELLOW,
                        inspection.valid
                                ? "ZIP enthält keine Dateien; sehr kleines/leeres Archiv – manuell prüfen"
                                : "ZIP ist nicht lesbar oder beschädigt; vor dem Löschen manuell prüfen",
                        state);
                return;
            }
        }

        if (isKcDevelopmentArchive(file)) {
            state.developmentArchivesSeen++;
            state.developmentArchiveBytes += size;
            if (isInDownloadTree(file) && age >= RECENT_ARCHIVE_PROTECTION) {
                addCandidate(file, size, Risk.GREEN,
                        "Altes KC-Entwicklungsarchiv im Download-Baum (>3 Tage); Entwicklungsstand – zum Löschen freigegeben", state);
            } else if (isInDownloadTree(file)) {
                addCandidate(file, size, Risk.YELLOW,
                        "Frisches KC-/Entwicklungsarchiv im Download-Baum (<3 Tage); geschützt, damit aktuelle Claude-/Code-Übergaben nicht gelöscht werden", state);
            } else {
                addCandidate(file, size, Risk.YELLOW,
                        "KC-/Entwicklungsarchiv außerhalb des Download-Baums; alter Entwicklungsstand möglich – manuell prüfen", state);
            }
            return;
        }

        if (TEMP_EXT.contains(ext) && age > 14 * DAY && size > 256 * 1024) {
            addCandidate(file, size, Risk.GREEN, "Alte temporäre/Protokolldatei (>14 Tage)", state);
            return;
        }
        if ((ext.equals("bak") || ext.equals("old")) && age > 14 * DAY) {
            addCandidate(file, size, Risk.GREEN, "Alte Sicherungs-/Altdatei; Inhalt vor Löschung prüfen", state);
            return;
        }
        if (ARCHIVE_EXT.contains(ext) && age > 14 * DAY &&
                (size >= MB || isDirectDownloadFile(file))) {
            addCandidate(file, size, Risk.YELLOW,
                    isDirectDownloadFile(file)
                            ? "Altes Archiv/Installationspaket (>14 Tage; im Download auch unter 1 MB)"
                            : "Altes Archiv/Installationspaket (>14 Tage)", state);
            return;
        }
        if ((name.contains("backup") || name.contains("sicherung") || name.contains("kopie") || name.contains("copy") || name.contains("_old"))
                && age > 30 * DAY && size >= MB) {
            addCandidate(file, size, Risk.YELLOW, "Dateiname deutet auf Sicherung/Kopie hin (>30 Tage)", state);
            return;
        }
        if (size >= 250 * MB) {
            addCandidate(file, size, devPath ? Risk.YELLOW : Risk.RED,
                    devPath ? "Sehr große Datei in einem Entwicklungsbereich" : "Sehr große Datei; nicht automatisch löschen", state);
        }
    }

    private void addCandidate(File file, long size, Risk risk, String reason, ScanState state) {
        addCandidate(file, size, risk, reason, null, 0, state);
    }

    private void addCandidate(File file, long size, Risk risk, String reason,
                              File referenceCopy, int duplicateGroup, ScanState state) {
        String path = file.getAbsolutePath();
        if (state.candidatePaths.add(path)) {
            candidates.add(new Candidate(file, size, risk, reason, referenceCopy, duplicateGroup));
        }
    }

    private boolean isNestedDuplicateProjectDir(File dir) {
        if (dir == null || !dir.isDirectory()) return false;
        String path = dir.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        boolean devContext = path.contains("/download/entwicklung") || path.contains("/development") ||
                path.contains("/projekte") || path.contains("/projects") || path.contains("/project") ||
                path.contains("/orbit");
        if (!devContext) return false;

        String current = normalizeDirName(dir.getName());
        if (current.length() < 6) return false;

        File parent = dir.getParentFile();
        int hops = 0;
        while (parent != null && hops++ < 4) {
            if (current.equals(normalizeDirName(parent.getName()))) return true;
            parent = parent.getParentFile();
        }
        return false;
    }

    private String normalizeDirName(String name) {
        if (name == null) return "";
        return name.toLowerCase(Locale.ROOT).trim().replaceAll("\\s+", " ");
    }

    private String extension(String name) {
        int i = name.lastIndexOf('.');
        return i >= 0 && i < name.length() - 1 ? name.substring(i + 1) : "";
    }

    private long folderSize(File dir, int depth) {
        if (depth > 25 || dir == null || !dir.exists()) return 0;
        if (dir.isFile()) return dir.length();
        long total = 0;
        File[] children;
        try { children = dir.listFiles(); } catch (SecurityException e) { return 0; }
        if (children == null) return 0;
        for (File child : children) total += folderSize(child, depth + 1);
        return total;
    }

    private boolean isWhatsAppPhoto(File file) {
        if (file == null || !file.isFile()) return false;
        String path = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        if (!path.contains("/android/media/com.whatsapp/whatsapp/media/whatsapp images/")) return false;
        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        return ext.equals("jpg") || ext.equals("jpeg") || ext.equals("png") ||
                ext.equals("webp") || ext.equals("heic") || ext.equals("heif");
    }

    private boolean isWhatsAppSentPhoto(File file) {
        String path = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        return path.contains("/whatsapp images/sent/");
    }

    private void findWhatsAppPhotoDuplicates(ScanState state) {
        int checkedGroups = 0;
        int totalGroups = state.whatsappPhotoSameSize.size();
        for (Map.Entry<Long, List<File>> e : state.whatsappPhotoSameSize.entrySet()) {
            checkedGroups++;
            if (checkedGroups == 1 || checkedGroups % 100 == 0 || checkedGroups == totalGroups) {
                final int done = checkedGroups;
                int pct = 76 + (int) ((8L * done) / Math.max(1, totalGroups));
                setScanProgress(pct, "6/8 WhatsApp-Dubletten · " + done + "/" +
                        totalGroups + " Größengruppen");
            }
            List<File> same = e.getValue();
            if (same.size() < 2) continue;

            Map<String, List<File>> hashes = new HashMap<>();
            for (File f : same) {
                String hash = sha256(f);
                if (hash != null) hashes.computeIfAbsent(hash, k -> new ArrayList<>()).add(f);
            }

            for (List<File> dupes : hashes.values()) {
                if (dupes.size() < 2) continue;
                dupes.sort((a, b) -> {
                    boolean aSent = isWhatsAppSentPhoto(a);
                    boolean bSent = isWhatsAppSentPhoto(b);
                    if (aSent != bSent) return aSent ? 1 : -1; // prefer keeping non-Sent copy
                    return Long.compare(a.lastModified(), b.lastModified());
                });

                File keep = dupes.get(0);
                int group = ++state.duplicateGroupSeq;
                for (int i = 1; i < dupes.size(); i++) {
                    File f = dupes.get(i);
                    state.whatsappPhotoDuplicates++;
                    state.whatsappPhotoDuplicateBytes += f.length();
                    addCandidate(f, f.length(), Risk.YELLOW,
                            "WhatsApp-Fotodublette; byte-identisch, Referenzkopie bleibt erhalten",
                            keep, group, state);
                }
            }
        }
    }

    private void findDuplicates(ScanState state) {
        int groups = 0;
        int scannedSizeGroups = 0;
        int totalSizeGroups = state.sameSize.size();
        for (Map.Entry<Long, List<File>> e : state.sameSize.entrySet()) {
            scannedSizeGroups++;
            if (scannedSizeGroups == 1 || scannedSizeGroups % 50 == 0 || scannedSizeGroups == totalSizeGroups) {
                final int done = scannedSizeGroups;
                int pct = 85 + (int) ((9L * done) / Math.max(1, totalSizeGroups));
                setScanProgress(pct, "7/8 Dateidubletten · " + done + "/" +
                        totalSizeGroups + " Größengruppen");
            }
            List<File> same = e.getValue();
            if (same.size() < 2 || e.getKey() < MB) continue;
            groups++;
            if (groups > 300) break; // keeps hashing bounded
            Map<String, List<File>> hashes = new HashMap<>();
            for (File f : same) {
                String hash = sha256(f);
                if (hash != null) hashes.computeIfAbsent(hash, k -> new ArrayList<>()).add(f);
            }
            for (List<File> dupes : hashes.values()) {
                if (dupes.size() < 2) continue;
                File keep = chooseReferenceCopy(dupes);
                int group = ++state.duplicateGroupSeq;
                for (File f : dupes) {
                    if (sameFile(f, keep)) continue;
                    addCandidate(f, f.length(), Risk.YELLOW,
                            "Byte-identische Dublette; Referenzkopie bleibt erhalten",
                            keep, group, state);
                }
            }
        }
    }

    private void setScanPhase(String text) {
        if (text == null) return;
        scanProgressPhase = text;
        runOnUiThread(() -> {
            if (scanning) renderScanProgress();
        });
    }

    private File chooseReferenceCopy(List<File> dupes) {
        File best = dupes.get(0);
        int bestScore = referencePriority(best);
        for (int i = 1; i < dupes.size(); i++) {
            File f = dupes.get(i);
            int score = referencePriority(f);
            if (score < bestScore || (score == bestScore && f.lastModified() < best.lastModified())) {
                best = f;
                bestScore = score;
            }
        }
        return best;
    }

    private int referencePriority(File file) {
        String p = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        if (p.contains("/dcim/camera/")) return 0;
        if (p.contains("/whatsapp images/") && !p.contains("/sent/")) return 1;
        if (p.contains("/documents/")) return 2;
        if (p.contains("/pictures/")) return 3;
        if (p.contains("/download/")) return 5;
        if (p.contains("/entwicklung") || p.contains("/development") || p.contains("/orbit/")) return 6;
        return 4;
    }

    private boolean sameFile(File a, File b) {
        return a != null && b != null && a.getAbsolutePath().equals(b.getAbsolutePath());
    }

    private String sha256(File file) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[1024 * 1024];
            try (BufferedInputStream in = new BufferedInputStream(new FileInputStream(file))) {
                int n;
                while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            }
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

    private boolean isImageFile(File file) {
        if (file == null || !file.isFile()) return false;
        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        return ext.equals("jpg") || ext.equals("jpeg") || ext.equals("png") ||
                ext.equals("webp") || ext.equals("heic") || ext.equals("heif") ||
                ext.equals("gif") || ext.equals("bmp");
    }

    private boolean isVideoFile(File file) {
        if (file == null || !file.isFile()) return false;
        String ext = extension(file.getName().toLowerCase(Locale.ROOT));
        return ext.equals("mp4") || ext.equals("m4v") || ext.equals("mov") ||
                ext.equals("3gp") || ext.equals("mkv") || ext.equals("webm");
    }

    private void showCandidatePreview(int position) {
        if (position < 0 || position >= candidates.size()) return;
        Candidate c = candidates.get(position);
        if (c.file.isDirectory()) {
            showDetailsDialog(c, position, "Ordner-Details");
        } else if (isImageFile(c.file)) {
            showImagePreview(c, position);
        } else if (isVideoFile(c.file)) {
            showVideoPreview(c, position);
        } else {
            showDetailsDialog(c, position, "Datei-Details");
        }
    }

    private String candidateDetails(Candidate c) {
        StringBuilder sb = new StringBuilder();
        sb.append(c.file.getName()).append("\n")
                .append(Formatter.formatFileSize(this, c.size)).append("\n")
                .append(new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY)
                        .format(new Date(c.file.lastModified()))).append("\n\n")
                .append(c.reason).append("\n\n")
                .append("Pfad:\n").append(c.file.getAbsolutePath());
        if (c.duplicateGroup > 0) {
            sb.append("\n\nDublettengruppe: ").append(c.duplicateGroup);
        }
        if (c.referenceCopy != null) {
            sb.append("\n\nReferenz, die erhalten bleibt:\n")
                    .append(c.referenceCopy.getAbsolutePath());
        }
        return sb.toString();
    }

    private void showImagePreview(Candidate c, int position) {
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(10), dp(8), dp(10), dp(8));

        Bitmap bitmap = loadPreviewBitmap(c.file, 1800);
        if (bitmap != null) {
            ImageView image = new ImageView(this);
            image.setAdjustViewBounds(true);
            image.setScaleType(ImageView.ScaleType.FIT_CENTER);
            image.setImageBitmap(bitmap);
            body.addView(image, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        } else {
            TextView noPreview = new TextView(this);
            noPreview.setText("Bild konnte nicht als Vorschau geladen werden.");
            noPreview.setPadding(0, dp(12), 0, dp(12));
            body.addView(noPreview);
        }

        TextView details = new TextView(this);
        details.setText(candidateDetails(c));
        details.setTextSize(12);
        details.setPadding(0, dp(10), 0, 0);
        body.addView(details);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(body);

        new AlertDialog.Builder(this)
                .setTitle(c.duplicateGroup > 0 ? "Foto · Dublettengruppe " + c.duplicateGroup : "Foto-Vorschau")
                .setView(scroll)
                .setNegativeButton("Schließen", null)
                .setPositiveButton(list.isItemChecked(position) ? "Markierung lösen" : "Zum Löschen markieren",
                        (d, w) -> {
                            list.setItemChecked(position, !list.isItemChecked(position));
                            updateSelectedSummary();
                        })
                .show();
    }

    private Bitmap loadPreviewBitmap(File file, int maxDimension) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(file.getAbsolutePath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

            int sample = 1;
            while (bounds.outWidth / sample > maxDimension || bounds.outHeight / sample > maxDimension) {
                sample *= 2;
            }
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeFile(file.getAbsolutePath(), opts);
        } catch (Exception e) {
            return null;
        }
    }

    private void showVideoPreview(Candidate c, int position) {
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(8), dp(8), dp(8), dp(8));

        VideoView video = new VideoView(this);
        MediaController controls = new MediaController(this);
        controls.setAnchorView(video);
        video.setMediaController(controls);
        video.setVideoPath(c.file.getAbsolutePath());
        video.setOnPreparedListener(mp -> video.seekTo(1));
        body.addView(video, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(260)));

        TextView details = new TextView(this);
        details.setText(candidateDetails(c));
        details.setTextSize(12);
        details.setPadding(0, dp(8), 0, 0);
        body.addView(details);

        ScrollView scroll = new ScrollView(this);
        scroll.addView(body);

        new AlertDialog.Builder(this)
                .setTitle(c.duplicateGroup > 0 ? "Video · Dublettengruppe " + c.duplicateGroup : "Video-Vorschau")
                .setView(scroll)
                .setNegativeButton("Schließen", null)
                .setPositiveButton(list.isItemChecked(position) ? "Markierung lösen" : "Zum Löschen markieren",
                        (d, w) -> {
                            list.setItemChecked(position, !list.isItemChecked(position));
                            updateSelectedSummary();
                        })
                .show();
    }

    private void showDetailsDialog(Candidate c, int position, String title) {
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(candidateDetails(c))
                .setNegativeButton("Schließen", null)
                .setPositiveButton(list.isItemChecked(position) ? "Markierung lösen" : "Zum Löschen markieren",
                        (d, w) -> {
                            list.setItemChecked(position, !list.isItemChecked(position));
                            updateSelectedSummary();
                        })
                .show();
    }

    private void updateOverallSummary() {
        long green = 0, yellow = 0, red = 0;
        int gc = 0, yc = 0, rc = 0;
        for (Candidate c : candidates) {
            if (c.risk == Risk.GREEN) { green += c.size; gc++; }
            else if (c.risk == Risk.YELLOW) { yellow += c.size; yc++; }
            else { red += c.size; rc++; }
        }
        ScanState st = lastScanState;
        String archiveInfo = st == null ? "" : "\nArchive gesehen: " + st.archivesSeen +
                " · davon Entwicklung: " + st.developmentArchivesSeen +
                "\nWhatsApp-Fotos: " + st.whatsappPhotosSeen +
                " · Dubletten: " + st.whatsappPhotoDuplicates +
                " · Gruppen: " + st.duplicateGroupSeq +
                "\nEntwicklungs-Unterordner: " + st.developmentDirsSeen +
                " · Projektwurzeln: " + st.projectRootsSeen +
                " · mögliche Altstände: " + st.possibleOldProjectDirs +
                "\nHash-geprüft löschbar: " + st.verifiedContainedProjectDirs +
                " · " + Formatter.formatFileSize(this, st.verifiedContainedProjectBytes) +
                "\nEntpackte KC-Programmordner: " + st.unpackedKcProgramDirs +
                " · " + Formatter.formatFileSize(this, st.unpackedKcProgramBytes) +
                "\nLeere Ordnerbäume sicher löschbar: " + st.safeEmptyDirectoryTrees +
                "\nHauptordner: " + st.rootDirectoriesSeen +
                " · geschützt " + st.rootDirectoriesProtected +
                " · belegt " + st.rootDirectoriesOccupied +
                " · leer löschbar " + st.rootDirectoriesSafeEmpty +
                " · leer Zusatzprofil " + st.rootDirectoriesSecondaryEmpty +
                " · nicht lesbar " + st.rootDirectoriesUnreadable +
                "\nDoppelte Projektordner: " + st.nestedDuplicateFolders +
                "\nZIP-Prüfung: " + st.zipArchivesInspected + " geprüft · " +
                st.zipArchivesInvalid + " defekt · " + st.zipArchivesEmpty + " leer" +
                "\nZusatzspeicher: " + st.additionalStorageRootsFound + " erkannt · " +
                st.additionalStorageRootsEnumerated + " direkt aufgelistet · " +
                st.additionalStorageRootsScanned + " tief gescannt · " +
                st.additionalStorageRootsUnreadable + " nicht lesbar" +
                "\nGlobaler Android-Dateiindex: " + st.mediaStoreGlobalRows +
                " Einträge · " + st.mediaStoreGlobalArchivesSeen + " Archive · " +
                st.mediaStoreGlobalArchivesAdded + " zusätzlich gefunden";
        summary.setText("Gefunden (max. " + MAX_VISIBLE + " größte Treffer):\n" +
                "🟢 " + gc + " · " + Formatter.formatFileSize(this, green) + "   " +
                "🟡 " + yc + " · " + Formatter.formatFileSize(this, yellow) + "   " +
                "🔴 " + rc + " · " + Formatter.formatFileSize(this, red) + archiveInfo);
    }

    private boolean isInDownloadTree(File file) {
        if (file == null || !file.isFile()) return false;
        String filePath = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        return filePath.matches("^/storage/emulated/[^/]+/downloads?/.+");
    }

    private boolean isAutoCleanupArchiveExtension(String ext) {
        return ext.equals("zip") || ext.equals("rar") || ext.equals("7z") ||
                ext.equals("tar") || ext.equals("gz") || ext.equals("tgz") ||
                ext.equals("bz2") || ext.equals("xz");
    }

    private boolean isKcDevelopmentArchive(File file) {
        if (file == null || !file.isFile()) return false;
        String name = file.getName().toLowerCase(Locale.ROOT);
        String ext = extension(name);
        if (!isAutoCleanupArchiveExtension(ext)) return false;

        String path = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        String compactPath = path.replace(" ", "");
        String compactName = name.replace(" ", "");
        boolean developmentFolder = compactPath.contains("/entwicklung") || compactPath.contains("/projekte") ||
                compactPath.contains("/projekt") || compactPath.contains("/development") ||
                compactPath.contains("/projects") || compactPath.contains("/dev/") ||
                compactPath.contains("/orbit/") || compactPath.contains("/github/");
        boolean kcNamed = compactName.startsWith("kc_") || compactName.startsWith("kc-") ||
                compactName.startsWith("kc.");
        boolean projectNamed = kcNamed || compactName.contains("marktkasse") || compactName.contains("kasse") ||
                compactName.contains("dienstplan") || compactName.contains("dp2") || compactName.contains("dp3") ||
                compactName.contains("futura") || compactName.contains("academy") ||
                compactName.contains("verwaltung") || compactName.contains("manager") ||
                compactName.contains("communication") || compactName.contains("kommunikation") ||
                compactName.contains("framework") || compactName.contains("reiseassistent") ||
                compactName.contains("bilderrechner") || compactName.contains("systemcheck") ||
                compactName.contains("speichercheck") || compactName.contains("inventar") ||
                compactName.contains("weihnachtsmarkt");
        boolean versionNamed = compactName.matches(".*(v[0-9]+([._-][0-9]+)*|20[0-9]{2}[-_.][0-9]{1,2}[-_.][0-9]{1,2}|backup|sicherung|alt|old|komplett|zusammengefuehrt).*");
        return developmentFolder || kcNamed || (projectNamed && versionNamed);
    }

    private boolean isDirectDownloadFile(File file) {
        if (file == null || !file.isFile()) return false;
        File parent = file.getParentFile();
        if (parent == null) return false;
        String p = parent.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        return p.matches("^/storage/emulated/[^/]+/downloads?$");
    }

    private boolean isAutoDeleteSafe(Candidate c) {
        if (c == null || c.risk == Risk.RED) return false;

        // Automatik bleibt bewusst auf dem primären gemeinsamen Speicher.
        // Zusätzliche Android-Profile (z. B. /storage/emulated/999) werden
        // vollständig diagnostiziert, aber niemals ungefragt bereinigt.
        if (!isPrimarySharedStorage(c.file)) return false;

        String reason = c.reason == null ? "" : c.reason;

        if (isEmptyDirectoryCleanupCandidate(c)) {
            return c.risk == Risk.GREEN && isDirectoryTreeStillEmptyAndSafe(c.file, 0);
        }

        if (c.file.isDirectory() && reason.startsWith("Entpackter KC-Programmordner im Download-Baum")) {
            File top = findTopUnpackedKcCleanupRoot(c.file);
            return c.risk == Risk.GREEN && top != null && samePath(c.file, top);
        }

        if (c.file.isDirectory() &&
                reason.startsWith("Alter Projektstand vollständig bytegleich im Referenzordner enthalten")) {
            return c.risk == Risk.GREEN && c.referenceCopy != null && c.referenceCopy.isDirectory() &&
                    !isDescendantOf(c.referenceCopy, c.file) && !samePath(c.file, c.referenceCopy);
        }

        if (reason.startsWith("Altes KC-Entwicklungsarchiv im Download-Baum")) {
            long age = System.currentTimeMillis() - c.file.lastModified();
            return age >= RECENT_ARCHIVE_PROTECTION &&
                    isInDownloadTree(c.file) && isKcDevelopmentArchive(c.file);
        }

        if (!isDirectDownloadFile(c.file)) return false;

        if (reason.startsWith("Byte-identische Dublette")) {
            return true;
        }

        if (reason.startsWith("Altes Archiv/Installationspaket")) {
            String ext = extension(c.file.getName().toLowerCase(Locale.ROOT));
            return ext.equals("zip") || ext.equals("rar") || ext.equals("7z") ||
                    ext.equals("tar") || ext.equals("gz") || ext.equals("tgz") ||
                    ext.equals("bz2") || ext.equals("xz");
        }

        return false;
    }

    private List<Integer> autoSafePositions() {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) {
            if (isAutoDeleteSafe(candidates.get(i))) out.add(i);
        }
        return out;
    }

    private void updateAutoCleanButton() {
        if (autoCleanButton == null) return;
        List<Integer> safe = autoSafePositions();
        long bytes = 0;
        for (int p : safe) bytes += candidates.get(p).size;
        autoCleanButton.setEnabled(!safe.isEmpty() && !scanning);
        autoCleanButton.setText(safe.isEmpty()
                ? "Auto löschen"
                : "Auto löschen (" + safe.size() + ")");
    }

    private void confirmAutoCleanup() {
        List<Integer> safe = autoSafePositions();
        if (safe.isEmpty()) {
            Toast.makeText(this, "Keine automatisch freigegebenen Treffer vorhanden.", Toast.LENGTH_SHORT).show();
            return;
        }

        long bytes = 0;
        for (int p : safe) bytes += candidates.get(p).size;

        String msg = safe.size() + " eindeutig freigegebene Treffer mit insgesamt " +
                Formatter.formatFileSize(this, bytes) + " werden dauerhaft gelöscht.\n\n" +
                "Automatisch gelöscht werden nur:\n" +
                "• leere Ordner bzw. reine Leerordner-Bäume außerhalb geschützter Android-, System-, App- und Medienbereiche im primären Speicher; direkt vor dem Löschen wird erneut auf Leerstand geprüft\n" +
                "• entpackte Hauptordner von KC Verwaltung, Money Butler, Kasse/MarktKasse und PC Manager im Download-Baum; verschachtelte Unterordner werden nicht doppelt gezählt\n" +
                "• ältere Projektstände, deren sämtliche Dateien per SHA-256 am gleichen relativen Pfad bytegleich im Referenzstand vorhanden sind\n" +
                "• KC-/Entwicklungsarchive (ZIP/RAR/7Z/TAR/GZ/TGZ/BZ2/XZ) im Download-Baum erst ab 3 Tagen Alter\n" +
                "• alte ZIP/RAR/7Z/TAR/GZ/TGZ/BZ2/XZ-Archive direkt im Download-Ordner – auch kleine Dateien unter 1 MB\n" +
                "• byte-identische Dubletten direkt im Download-Ordner, wenn eine andere Kopie erhalten bleibt\n\n" +
                "Geschützt bleiben insbesondere Android, versteckte Ordner, App-Strukturen, MIUI/Xiaomi, downloaded_rom, WhatsApp, DCIM/Kamera, Pictures/Bilder, Documents und APK/AAB-Dateien. Zusätzliche Android-Speicherprofile werden gescannt, aber nicht automatisch bereinigt.\n\n" +
                "Der Vorgang kann nicht rückgängig gemacht werden.";

        new AlertDialog.Builder(this)
                .setTitle("Sicher automatisch bereinigen?")
                .setMessage(msg)
                .setNegativeButton("Abbrechen", null)
                .setPositiveButton("Jetzt bereinigen", (d, w) -> deleteSelected(safe))
                .show();
    }

    private void setAllChecked(boolean checked) {
        if (list == null) return;
        for (int i = 0; i < candidates.size(); i++) {
            list.setItemChecked(i, checked);
        }
        updateSelectedSummary();
    }

    private List<Integer> selectedPositions() {
        List<Integer> out = new ArrayList<>();
        android.util.SparseBooleanArray checked = list.getCheckedItemPositions();
        for (int i = 0; i < checked.size(); i++) if (checked.valueAt(i)) out.add(checked.keyAt(i));
        return out;
    }

    private void updateSelectedSummary() {
        List<Integer> selected = selectedPositions();
        long bytes = 0;
        for (int p : selected) if (p >= 0 && p < candidates.size()) bytes += candidates.get(p).size;
        deleteButton.setText(selected.isEmpty() ? "Auswahl löschen" : "Löschen: " + selected.size() + " · " + Formatter.formatFileSize(this, bytes));
    }

    private void confirmDelete() {
        List<Integer> selected = selectedPositions();
        if (selected.isEmpty()) {
            Toast.makeText(this, "Bitte zuerst Dateien oder Ordner auswählen.", Toast.LENGTH_SHORT).show();
            return;
        }
        long bytes = 0;
        boolean hasRed = false;
        for (int p : selected) {
            Candidate c = candidates.get(p);
            bytes += c.size;
            if (c.risk == Risk.RED) hasRed = true;
        }
        String msg = selected.size() + " Einträge mit insgesamt " + Formatter.formatFileSize(this, bytes) +
                " werden dauerhaft gelöscht.\n\n" + (hasRed ? "ACHTUNG: Die Auswahl enthält rote Treffer.\n\n" : "") +
                "Dieser Vorgang kann nicht rückgängig gemacht werden.";
        new AlertDialog.Builder(this)
                .setTitle("Löschen wirklich freigeben?")
                .setMessage(msg)
                .setNegativeButton("Abbrechen", null)
                .setPositiveButton("Dauerhaft löschen", (d, w) -> deleteSelected(selected))
                .show();
    }

    private void deleteSelected(List<Integer> selected) {
        progress.setVisibility(View.VISIBLE);
        deleteButton.setEnabled(false);
        autoCleanButton.setEnabled(false);
        scanButton.setEnabled(false);
        new Thread(() -> {
            int ok = 0, fail = 0, skipped = 0;
            long freed = 0;
            for (int p : selected) {
                if (p < 0 || p >= candidates.size()) continue;
                Candidate c = candidates.get(p);
                if (isEmptyDirectoryCleanupCandidate(c) && !isDirectoryTreeStillEmptyAndSafe(c.file, 0)) {
                    skipped++;
                    continue;
                }
                if (deleteRecursive(c.file)) { ok++; freed += c.size; }
                else fail++;
            }
            int okF = ok, failF = fail, skippedF = skipped;
            long freedF = freed;
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                Toast.makeText(this, "Gelöscht: " + okF +
                        " · freigegeben ca. " + Formatter.formatFileSize(this, freedF) +
                        (skippedF > 0 ? " · übersprungen (nicht mehr leer/geschützt): " + skippedF : "") +
                        (failF > 0 ? " · Fehler: " + failF : ""), Toast.LENGTH_LONG).show();
                startScan();
            });
        }).start();
    }

    private boolean deleteRecursive(File f) {
        if (f == null || !f.exists()) return true;
        if (isExcludedPath(f.getAbsolutePath())) return false;
        if (f.isDirectory()) {
            File[] children = f.listFiles();
            if (children != null) for (File c : children) if (!deleteRecursive(c)) return false;
        }
        try { return f.delete(); } catch (SecurityException e) { return false; }
    }

    private String buildReportText() {
        StringBuilder sb = new StringBuilder();
        sb.append("KC SpeicherCheck v").append(BuildConfig.VERSION_NAME).append("\n");
        sb.append("Erstellt: ").append(new Date()).append("\n");
        sb.append("Gerät: ").append(Build.MANUFACTURER).append(" ").append(Build.MODEL).append("\n");
        sb.append("Android: ").append(Build.VERSION.RELEASE).append("\n");
        ScanState st = lastScanState;
        if (st != null) {
            sb.append("Scan: ").append(st.files).append(" Dateien, ").append(st.dirs).append(" Ordner geprüft\n");
            sb.append("Archive gesehen: ").append(st.archivesSeen)
                    .append(" | ").append(st.archiveBytesSeen).append(" Bytes\n");
            sb.append("Entwicklungsarchive erkannt: ").append(st.developmentArchivesSeen)
                    .append(" | ").append(st.developmentArchiveBytes).append(" Bytes\n");
            sb.append("Archive nach Typ: ").append(new java.util.TreeMap<>(st.archiveCountByExt)).append("\n");
            sb.append("Nicht lesbare Ordner: ").append(st.unreadableDirs).append("\n");
            sb.append("WhatsApp-Fotos gesehen: ").append(st.whatsappPhotosSeen).append("\n");
            sb.append("WhatsApp-Fotodubletten: ").append(st.whatsappPhotoDuplicates)
                    .append(" | ").append(st.whatsappPhotoDuplicateBytes).append(" Bytes\n");
            sb.append("Dublettengruppen: ").append(st.duplicateGroupSeq).append("\n");
            sb.append("Doppelte/verschachtelte Projektordner: ").append(st.nestedDuplicateFolders)
                    .append(" | ").append(st.nestedDuplicateFolderBytes).append(" Bytes\n");
            sb.append("Entwicklungs-Unterordner gesehen: ").append(st.developmentDirsSeen).append("\n");
            sb.append("Erkannte Projektwurzeln: ").append(st.projectRootsSeen).append("\n");
            sb.append("Mögliche alte/doppelte Projektstände: ").append(st.possibleOldProjectDirs)
                    .append(" | ").append(st.possibleOldProjectBytes).append(" Bytes\n");
            sb.append("Davon per SHA-256 vollständig enthalten/löschbar: ").append(st.verifiedContainedProjectDirs)
                    .append(" | ").append(st.verifiedContainedProjectBytes).append(" Bytes\n");
            sb.append("Projektstände mit nur hier vorhandenen Dateien: ").append(st.projectDirsWithUniqueFiles).append("\n");
            sb.append("Projektstände mit Abweichungen/nicht prüfbaren Dateien: ").append(st.projectDirsWithDifferentFiles).append("\n");
            sb.append("Entpackte KC-Programmordner löschbar: ").append(st.unpackedKcProgramDirs)
                    .append(" | ").append(st.unpackedKcProgramBytes).append(" Bytes\n");
            sb.append("Leere Ordnerbäume sicher löschbar: ").append(st.safeEmptyDirectoryTrees).append("\n");
            sb.append("Hauptordner geprüft: ").append(st.rootDirectoriesSeen)
                    .append("; geschützt ").append(st.rootDirectoriesProtected)
                    .append("; belegt ").append(st.rootDirectoriesOccupied)
                    .append("; leer/löschbar ").append(st.rootDirectoriesSafeEmpty)
                    .append("; leer Zusatzprofil ").append(st.rootDirectoriesSecondaryEmpty)
                    .append("; nicht lesbar ").append(st.rootDirectoriesUnreadable).append("\n");
            sb.append("Download im Hauptscan: ").append(st.downloadFilesSeen).append(" Dateien, ")
                    .append(st.downloadDirsSeen).append(" Ordner, ")
                    .append(st.downloadArchivesSeen).append(" Archive\n");
            sb.append("Download-Kontrollscan: ").append(st.downloadAuditFiles).append(" Dateien, ")
                    .append(st.downloadAuditDirs).append(" Ordner, ")
                    .append(st.downloadAuditArchives).append(" Archive\n");
            sb.append("Android Download-Index: ").append(st.mediaStoreDownloadRows).append(" Einträge; ")
                    .append(st.mediaStoreFilesAdded).append(" zusätzlich erfasste Dateien; ")
                    .append(st.mediaStoreArchivesAdded).append(" zusätzliche Archive; Fehler ")
                    .append(st.mediaStoreQueryErrors).append("\n");
            sb.append("Globaler Android-Dateiindex: ").append(st.mediaStoreGlobalRows)
                    .append(" Einträge; ").append(st.mediaStoreGlobalArchivesSeen)
                    .append(" Archive gesehen; ").append(st.mediaStoreGlobalArchivesAdded)
                    .append(" zusätzliche Archive erfasst; ").append(st.mediaStoreGlobalPathMisses)
                    .append(" Indexeinträge ohne erreichbaren Dateipfad; Fehler ")
                    .append(st.mediaStoreGlobalQueryErrors).append("\n");
            sb.append("Zusätzliche Speicherwurzeln: ").append(st.additionalStorageRootsFound)
                    .append(" erkannt; ").append(st.additionalStorageRootsEnumerated)
                    .append(" direkt unter /storage/emulated aufgelistet; ")
                    .append(st.additionalStorageRootsScanned)
                    .append(" tief gescannt; ").append(st.additionalStorageRootsUnreadable)
                    .append(" nicht lesbar; Auto-Löschen dort gesperrt\n");
            sb.append("ZIP-Prüfung: ").append(st.zipArchivesInspected).append(" geprüft; ")
                    .append(st.zipArchivesInvalid).append(" ungültig/beschädigt; ")
                    .append(st.zipArchivesEmpty).append(" ohne Dateien\n");

            sb.append("\nHAUPTVERZEICHNIS – DIREKTE ORDNER\n");
            if (st.rootDirectories.isEmpty()) {
                sb.append("Keine direkten Hauptordner erkannt oder Hauptverzeichnis nicht lesbar.\n");
            } else {
                int ri = 1;
                for (RootDirectoryEntry entry : st.rootDirectories) {
                    sb.append(ri++).append(". ").append(entry.assessment).append("\n");
                    sb.append("Name: ").append(entry.dir.getName()).append("\n");
                    sb.append("Direkte Elemente: ")
                            .append(entry.directItems < 0 ? "nicht lesbar" : String.valueOf(entry.directItems))
                            .append("\n");
                    sb.append("Pfad: ").append(entry.dir.getAbsolutePath()).append("\n\n");
                }
            }

            sb.append("\nPROJEKTORDNER-DIAGNOSE – Unterverzeichnisse und Versionsstände\n");
            if (st.projectDirs.isEmpty()) {
                sb.append("Keine Projektordner-Wurzeln erkannt.\n");
            } else {
                SimpleDateFormat projectDate = new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.GERMANY);
                int pi = 1;
                for (ProjectDirEntry p : st.projectDirs) {
                    sb.append(pi++).append(". ").append(p.assessment).append("\n");
                    sb.append("Name: ").append(p.dir.getName()).append("\n");
                    sb.append("Pfad: ").append(p.dir.getAbsolutePath()).append("\n");
                    sb.append("Projektgruppe: ").append(p.key).append("\n");
                    sb.append("Tiefe unter Entwicklungsbereich: ").append(p.developmentDepth).append("\n");
                    sb.append("Inhalt: ").append(p.stats.files).append(" Dateien, ")
                            .append(Math.max(0, p.stats.dirs - 1)).append(" Unterordner, ")
                            .append(p.stats.bytes).append(" Bytes\n");
                    if (p.stats.newestModified > 0) {
                        sb.append("Neueste Änderung im Ordnerbaum: ")
                                .append(projectDate.format(new Date(p.stats.newestModified))).append("\n");
                    }
                    if (p.reference != null) {
                        sb.append("Referenzordner: ").append(p.reference.getAbsolutePath()).append("\n");
                    }
                    if (p.comparison != null) {
                        sb.append("SHA-256-Vergleich: ")
                                .append(p.comparison.matchedFiles).append(" bytegleich, ")
                                .append(p.comparison.missingInReference).append(" nur hier vorhanden, ")
                                .append(p.comparison.differentFiles).append(" abweichend, ")
                                .append(p.comparison.unreadableFiles).append(" nicht prüfbar\n");
                        if (!p.comparison.missingSamples.isEmpty()) {
                            sb.append("Nur-hier-Beispiele: ").append(p.comparison.missingSamples).append("\n");
                        }
                        if (!p.comparison.differentSamples.isEmpty()) {
                            sb.append("Abweichungs-Beispiele: ").append(p.comparison.differentSamples).append("\n");
                        }
                    }
                    sb.append("\n");
                }
            }

            sb.append("\nARCHIVDIAGNOSE – alle im Scan erreichbaren Archive\n");
            sb.append("Ausgenommen bleiben Android/data, Android/obb und Android/.Trash.\n");
            if (st.archives.isEmpty()) {
                sb.append("Keine Archive gefunden.\n");
            } else {
                List<ArchiveEntry> archiveReport = new ArrayList<>(st.archives);
                archiveReport.sort((a, b) -> a.file.getAbsolutePath().compareToIgnoreCase(b.file.getAbsolutePath()));
                int ai = 1;
                for (ArchiveEntry a : archiveReport) {
                    sb.append(ai++).append(". ")
                            .append(a.ext.toUpperCase(Locale.ROOT))
                            .append(" | ").append(a.size).append(" Bytes")
                            .append(" | ").append(a.assessment).append("\n");
                    sb.append("Name: ").append(a.file.getName()).append("\n");
                    if (a.inspection != null) {
                        sb.append("ZIP-Prüfung: ")
                                .append(a.inspection.valid ? "gültig" : "ungültig/beschädigt")
                                .append("; Einträge ").append(a.inspection.entries)
                                .append("; Dateien ").append(a.inspection.files)
                                .append("; unkomprimierte Größe ").append(a.inspection.uncompressedBytes).append(" Bytes");
                        if (a.inspection.error != null) {
                            sb.append("; Fehlerklasse ").append(a.inspection.error);
                        }
                        sb.append("\n");
                    }
                    sb.append("Pfad: ").append(a.file.getAbsolutePath()).append("\n\n");
                }
            }
        }
        sb.append("\nBewertung: GRUEN = meist erzeugbar/temporär; GELB = prüfen; ROT = nicht pauschal löschen\n\n");
        int i = 1;
        for (Candidate c : candidates) {
            sb.append(i++).append(". ").append(c.risk)
                    .append(" | ").append(c.size).append(" Bytes")
                    .append(" | AUTO-SICHER=").append(isAutoDeleteSafe(c) ? "JA" : "NEIN")
                    .append(" | ").append(c.file.isDirectory() ? "ORDNER" : "DATEI")
                    .append(" | ").append(c.reason).append("\n");
            sb.append("Name: ").append(c.file.getName()).append("\n");
            sb.append("Pfad: ").append(c.file.getAbsolutePath()).append("\n");
            if (c.duplicateGroup > 0) {
                sb.append("Dublettengruppe: ").append(c.duplicateGroup).append("\n");
            }
            if (c.referenceCopy != null) {
                sb.append("Referenzkopie: ").append(c.referenceCopy.getAbsolutePath()).append("\n");
            }
            sb.append("\n");
        }
        return sb.toString();
    }

    private void shareReport() {
        if (candidates.isEmpty()) {
            Toast.makeText(this, "Bitte zuerst den Speicher scannen.", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_SUBJECT, "KC SpeicherCheck Bericht");
        send.putExtra(Intent.EXTRA_TEXT, buildReportText());
        try {
            startActivity(Intent.createChooser(send, "Bericht senden an …"));
        } catch (Exception e) {
            Toast.makeText(this, "Teilen konnte nicht geöffnet werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void saveReport() {
        File docs = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS);
        File dir = new File(docs, "KC_SpeicherCheck");
        if (!dir.exists() && !dir.mkdirs()) {
            Toast.makeText(this, "Berichtsordner konnte nicht angelegt werden.", Toast.LENGTH_LONG).show();
            return;
        }
        String ts = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.GERMANY).format(new Date());
        File out = new File(dir, "SpeicherCheck_" + ts + ".txt");
        try (FileOutputStream fos = new FileOutputStream(out)) {
            fos.write(buildReportText().getBytes(StandardCharsets.UTF_8));
            Toast.makeText(this, "Bericht gespeichert:\n" + out.getAbsolutePath(), Toast.LENGTH_LONG).show();
        } catch (IOException e) {
            Toast.makeText(this, "Bericht konnte nicht gespeichert werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private void maybeCheckForUpdates() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        long last = p.getLong("last_update_check", 0L);
        if (System.currentTimeMillis() - last >= UPDATE_CHECK_INTERVAL) {
            checkForUpdates(false);
        }
    }

    private void checkForUpdates(boolean userInitiated) {
        if (updateButton != null) updateButton.setEnabled(false);
        if (userInitiated) status.setText("Update wird geprüft …");

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(UPDATE_MANIFEST_URL);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                conn.setRequestProperty("User-Agent", "KC-SpeicherCheck/" + BuildConfig.VERSION_NAME);
                conn.setUseCaches(false);
                int code = conn.getResponseCode();
                if (code != 200) throw new IOException("HTTP " + code);

                String json;
                try (InputStream in = conn.getInputStream()) {
                    byte[] data = readAll(in, 256 * 1024);
                    json = new String(data, StandardCharsets.UTF_8);
                }
                JSONObject o = new JSONObject(json);
                UpdateInfo info = new UpdateInfo(
                        o.getInt("versionCode"),
                        o.optString("versionName", ""),
                        o.optString("apkUrl", ""),
                        o.optString("sha256", ""),
                        o.optString("notes", "")
                );
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putLong("last_update_check", System.currentTimeMillis()).apply();

                runOnUiThread(() -> {
                    if (updateButton != null) updateButton.setEnabled(true);
                    if (info.versionCode > BuildConfig.VERSION_CODE) {
                        showUpdateDialog(info);
                    } else if (userInitiated) {
                        status.setText("Update-Prüfung abgeschlossen.");
                        Toast.makeText(this, "Du hast bereits die aktuelle Version " + BuildConfig.VERSION_NAME + ".", Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Exception e) {
                runOnUiThread(() -> {
                    if (updateButton != null) updateButton.setEnabled(true);
                    if (userInitiated) {
                        status.setText("Update-Prüfung fehlgeschlagen.");
                        Toast.makeText(this, "Update konnte nicht geprüft werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
                    }
                });
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private byte[] readAll(InputStream in, int maxBytes) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > maxBytes) throw new IOException("Update-Datei ist unerwartet groß");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private void showUpdateDialog(UpdateInfo info) {
        String target = info.versionName.isEmpty() ? String.valueOf(info.versionCode) : info.versionName;
        StringBuilder msg = new StringBuilder();
        msg.append("Installiert: ").append(BuildConfig.VERSION_NAME)
                .append("\nVerfügbar: ").append(target);
        if (!info.notes.isEmpty()) msg.append("\n\nÄnderungen:\n").append(info.notes);
        msg.append("\n\nDas Update wird nur nach deiner Freigabe geladen und installiert.");
        new AlertDialog.Builder(this)
                .setTitle("KC SpeicherCheck – Update verfügbar")
                .setMessage(msg.toString())
                .setNegativeButton("Später", null)
                .setPositiveButton("Update laden", (d, w) -> prepareUpdateDownload(info))
                .show();
    }

    private void prepareUpdateDownload(UpdateInfo info) {
        if (!info.apkUrl.startsWith("https://")) {
            Toast.makeText(this, "Für diese Version ist noch keine sichere APK hinterlegt.", Toast.LENGTH_LONG).show();
            return;
        }
        if (!info.sha256.matches("[0-9a-f]{64}")) {
            Toast.makeText(this, "Update abgebrochen: SHA-256-Prüfsumme fehlt oder ist ungültig.", Toast.LENGTH_LONG).show();
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            savePendingUpdate(info);
            new AlertDialog.Builder(this)
                    .setTitle("Installationsfreigabe erforderlich")
                    .setMessage("Android muss KC SpeicherCheck einmal erlauben, Updates aus dieser Quelle zu installieren. Danach kehrst du automatisch zur App zurück.")
                    .setNegativeButton("Abbrechen", (d, w) -> clearPendingUpdate())
                    .setPositiveButton("Freigabe öffnen", (d, w) -> {
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName()));
                        startActivity(i);
                    })
                    .show();
            return;
        }
        startUpdateDownload(info);
    }

    private void savePendingUpdate(UpdateInfo info) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putInt("pending_version_code", info.versionCode)
                .putString("pending_version_name", info.versionName)
                .putString("pending_apk_url", info.apkUrl)
                .putString("pending_sha256", info.sha256)
                .putString("pending_notes", info.notes)
                .apply();
    }

    private void clearPendingUpdate() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .remove("pending_version_code")
                .remove("pending_version_name")
                .remove("pending_apk_url")
                .remove("pending_sha256")
                .remove("pending_notes")
                .apply();
    }

    private void resumePendingUpdateAfterPermission() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String url = p.getString("pending_apk_url", "");
        if (url.isEmpty()) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) return;

        UpdateInfo info = new UpdateInfo(
                p.getInt("pending_version_code", BuildConfig.VERSION_CODE),
                p.getString("pending_version_name", ""),
                url,
                p.getString("pending_sha256", ""),
                p.getString("pending_notes", "")
        );
        clearPendingUpdate();
        startUpdateDownload(info);
    }

    private void startUpdateDownload(UpdateInfo info) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(info.apkUrl));
            String version = info.versionName.isEmpty() ? String.valueOf(info.versionCode) : info.versionName;
            String fileName = "KC_SpeicherCheck_" + version.replaceAll("[^0-9A-Za-z._-]", "_") + ".apk";
            req.setTitle("KC SpeicherCheck " + version);
            req.setDescription("Update wird geladen");
            req.setMimeType("application/vnd.android.package-archive");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setAllowedOverMetered(true);
            req.setAllowedOverRoaming(false);
            req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            long id = dm.enqueue(req);
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                    .putLong("update_download_id", id)
                    .putString("download_sha256", info.sha256)
                    .putString("download_version_name", version)
                    .apply();
            Toast.makeText(this, "Update " + version + " wird geladen.", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Update-Download konnte nicht gestartet werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private final BroadcastReceiver updateDownloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            long expected = getSharedPreferences(PREFS, MODE_PRIVATE).getLong("update_download_id", -1L);
            if (id == expected && id != -1L) verifyAndInstallDownloadedUpdate(id);
        }
    };

    private void registerUpdateReceiver() {
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(updateDownloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(updateDownloadReceiver, filter);
        }
    }

    private void checkCompletedPendingDownload() {
        long id = getSharedPreferences(PREFS, MODE_PRIVATE).getLong("update_download_id", -1L);
        if (id == -1L) return;
        DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        try (Cursor c = dm.query(new DownloadManager.Query().setFilterById(id))) {
            if (c != null && c.moveToFirst()) {
                int statusIndex = c.getColumnIndex(DownloadManager.COLUMN_STATUS);
                if (statusIndex >= 0 && c.getInt(statusIndex) == DownloadManager.STATUS_SUCCESSFUL) {
                    verifyAndInstallDownloadedUpdate(id);
                }
            }
        } catch (Exception ignored) { }
    }

    private void verifyAndInstallDownloadedUpdate(long id) {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        String expectedHash = p.getString("download_sha256", "");
        String version = p.getString("download_version_name", "");
        p.edit().remove("update_download_id").apply();

        new Thread(() -> {
            DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
            Uri uri = dm.getUriForDownloadedFile(id);
            if (uri == null) {
                runOnUiThread(() -> Toast.makeText(this, "Update-Datei wurde nicht gefunden.", Toast.LENGTH_LONG).show());
                return;
            }
            String actual = sha256(uri);
            if (actual == null || !actual.equalsIgnoreCase(expectedHash)) {
                dm.remove(id);
                runOnUiThread(() -> Toast.makeText(this, "Update verworfen: Sicherheitsprüfung (SHA-256) fehlgeschlagen.", Toast.LENGTH_LONG).show());
                return;
            }

            runOnUiThread(() -> {
                try {
                    Intent install = new Intent(Intent.ACTION_VIEW);
                    install.setDataAndType(uri, "application/vnd.android.package-archive");
                    install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(install);
                    Toast.makeText(this, "Update " + version + " geprüft. Android öffnet jetzt die Installation.", Toast.LENGTH_LONG).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Installer konnte nicht geöffnet werden: " + e.getMessage(), Toast.LENGTH_LONG).show();
                }
            });
        }).start();
    }

    private String sha256(Uri uri) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] buf = new byte[1024 * 1024];
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) return null;
                int n;
                while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
            }
            byte[] d = md.digest();
            StringBuilder sb = new StringBuilder();
            for (byte b : d) sb.append(String.format(Locale.ROOT, "%02x", b));
            return sb.toString();
        } catch (Exception e) {
            return null;
        }
    }

}
