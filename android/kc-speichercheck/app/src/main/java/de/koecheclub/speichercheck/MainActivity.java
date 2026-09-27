package de.koecheclub.speichercheck;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
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
import android.provider.Settings;
import android.database.Cursor;
import android.text.format.Formatter;
import android.view.GestureDetector;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
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
    private Button permissionButton;
    private Button scanButton;
    private Button autoCleanButton;
    private Button deleteButton;
    private Button reportButton;
    private Button shareReportButton;
    private Button updateButton;
    private volatile boolean scanning = false;
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
        root.addView(row3);

        status = new TextView(this);
        status.setText("Bereit");
        status.setPadding(0, dp(6), 0, dp(3));
        root.addView(status);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
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
        progress.setVisibility(View.VISIBLE);
        status.setText("Scan läuft …");
        summary.setText("Dateien werden geprüft.");
        scanButton.setEnabled(false);
        deleteButton.setEnabled(false);
        autoCleanButton.setEnabled(false);
        reportButton.setEnabled(false);
        shareReportButton.setEnabled(false);

        new Thread(() -> {
            ScanState state = new ScanState();
            File root = Environment.getExternalStorageDirectory();
            scanTree(root, state);
            findWhatsAppPhotoDuplicates(state);
            findDuplicates(state);
            lastScanState = state;

            Collections.sort(candidates, Comparator.comparingLong((Candidate c) -> c.size).reversed());
            if (candidates.size() > MAX_VISIBLE) {
                candidates.subList(MAX_VISIBLE, candidates.size()).clear();
            }

            runOnUiThread(() -> {
                displayRows.clear();
                for (Candidate c : candidates) displayRows.add(c.display(this));
                adapter.notifyDataSetChanged();
                progress.setVisibility(View.GONE);
                scanning = false;
                scanButton.setEnabled(true);
                deleteButton.setEnabled(!candidates.isEmpty());
                updateAutoCleanButton();
                reportButton.setEnabled(!candidates.isEmpty());
                shareReportButton.setEnabled(!candidates.isEmpty());
                status.setText("Scan abgeschlossen: " + state.files + " Dateien, " + state.dirs + " Ordner geprüft.");
                updateOverallSummary();
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
        int duplicateGroupSeq = 0;
        final Map<Long, List<File>> sameSize = new HashMap<>();
        final Map<Long, List<File>> whatsappPhotoSameSize = new HashMap<>();
        final Map<String, Long> archiveCountByExt = new HashMap<>();
        final Set<String> candidatePaths = new HashSet<>();
    }

    private void scanTree(File file, ScanState state) {
        if (file == null || !file.exists()) return;
        String path = file.getAbsolutePath();
        if (isExcludedPath(path)) return;

        if (file.isDirectory()) {
            state.dirs++;

            if (isNestedDuplicateProjectDir(file)) {
                long sz = folderSize(file, 0);
                state.nestedDuplicateFolders++;
                state.nestedDuplicateFolderBytes += sz;
                addCandidate(file, sz, Risk.YELLOW,
                        "Verschachtelter gleichnamiger Entwicklungsordner; wahrscheinlich kompletter doppelter Projektstand – vor Löschung prüfen", state);
                return;
            }

            String name = file.getName().toLowerCase(Locale.ROOT);
            if (GENERATED_DIRS.contains(name)) {
                long sz = folderSize(file, 0);
                if (sz >= MB) addCandidate(file, sz, Risk.GREEN, "Erzeugter Entwicklungsordner; normalerweise wiederherstellbar", state);
                return; // avoid double counting inside generated folders
            }
            File[] children;
            try { children = file.listFiles(); } catch (SecurityException e) { state.unreadableDirs++; return; }
            if (children == null) { state.unreadableDirs++; return; }
            for (File child : children) scanTree(child, state);
        } else {
            state.files++;
            long size = file.length();
            state.totalBytes += size;
            if (size >= MB) state.sameSize.computeIfAbsent(size, k -> new ArrayList<>()).add(file);
            if (isWhatsAppPhoto(file)) {
                state.whatsappPhotosSeen++;
                if (size >= 64L * 1024L) {
                    state.whatsappPhotoSameSize.computeIfAbsent(size, k -> new ArrayList<>()).add(file);
                }
            }
            classifyFile(file, size, state);
            if (state.files % 500 == 0) {
                long f = state.files;
                runOnUiThread(() -> status.setText("Scan läuft … " + f + " Dateien geprüft"));
            }
        }
    }

    private boolean isExcludedPath(String path) {
        String p = path.replace('\\', '/');
        return p.contains("/Android/data") || p.contains("/Android/obb") || p.contains("/Android/.Trash");
    }

    private void classifyFile(File file, long size, ScanState state) {
        String name = file.getName().toLowerCase(Locale.ROOT);
        String ext = extension(name);
        long age = System.currentTimeMillis() - file.lastModified();
        String path = file.getAbsolutePath().toLowerCase(Locale.ROOT);
        boolean devPath = path.contains("github") || path.contains("gitlab") || path.contains("project") || path.contains("projekte") ||
                path.contains("entwicklung") || path.contains("development") || path.contains("source") || path.contains("src") || path.contains("build");

        if (ARCHIVE_EXT.contains(ext)) {
            state.archivesSeen++;
            state.archiveBytesSeen += size;
            state.archiveCountByExt.put(ext, state.archiveCountByExt.getOrDefault(ext, 0L) + 1L);
        }

        if (isKcDevelopmentArchive(file)) {
            state.developmentArchivesSeen++;
            state.developmentArchiveBytes += size;
            addCandidate(file, size, Risk.GREEN,
                    "KC-Entwicklungsarchiv im Download-Baum; alter Entwicklungsstand – zum Löschen freigegeben", state);
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
        if (ARCHIVE_EXT.contains(ext) && age > 14 * DAY && size >= MB) {
            addCandidate(file, size, Risk.YELLOW, "Altes Archiv/Installationspaket (>14 Tage)", state);
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
        for (Map.Entry<Long, List<File>> e : state.whatsappPhotoSameSize.entrySet()) {
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
        for (Map.Entry<Long, List<File>> e : state.sameSize.entrySet()) {
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
            sb.append("\n\nReferenzkopie, die erhalten bleibt:\n")
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
                "\nDoppelte Projektordner: " + st.nestedDuplicateFolders;
        summary.setText("Gefunden (max. " + MAX_VISIBLE + " größte Treffer):\n" +
                "🟢 " + gc + " · " + Formatter.formatFileSize(this, green) + "   " +
                "🟡 " + yc + " · " + Formatter.formatFileSize(this, yellow) + "   " +
                "🔴 " + rc + " · " + Formatter.formatFileSize(this, red) + archiveInfo);
    }

    private boolean isInDownloadTree(File file) {
        if (file == null || !file.isFile()) return false;
        String filePath = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);

        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (downloads != null) {
            String downloadPath = downloads.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
            if (filePath.startsWith(downloadPath + "/")) return true;
        }

        File storageRoot = Environment.getExternalStorageDirectory();
        if (storageRoot != null) {
            String rootPath = storageRoot.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
            if (filePath.startsWith(rootPath + "/download/") || filePath.startsWith(rootPath + "/downloads/")) return true;
        }
        return false;
    }

    private boolean isAutoCleanupArchiveExtension(String ext) {
        return ext.equals("zip") || ext.equals("rar") || ext.equals("7z") ||
                ext.equals("tar") || ext.equals("gz") || ext.equals("tgz") ||
                ext.equals("bz2") || ext.equals("xz");
    }

    private boolean isKcDevelopmentArchive(File file) {
        if (!isInDownloadTree(file)) return false;
        String name = file.getName().toLowerCase(Locale.ROOT);
        String ext = extension(name);
        if (!isAutoCleanupArchiveExtension(ext)) return false;

        String path = file.getAbsolutePath().replace('\\', '/').toLowerCase(Locale.ROOT);
        String compactPath = path.replace(" ", "");
        String compactName = name.replace(" ", "");
        boolean developmentFolder = compactPath.contains("/entwicklung") || compactPath.contains("/projekte") ||
                compactPath.contains("/projekt") || compactPath.contains("/development") ||
                compactPath.contains("/projects") || compactPath.contains("/dev/");
        boolean kcNamed = compactName.startsWith("kc_") || compactName.startsWith("kc-") ||
                compactName.startsWith("kc.");
        boolean projectNamed = kcNamed || compactName.contains("marktkasse") || compactName.contains("kasse") ||
                compactName.contains("dienstplan") || compactName.contains("dp2") ||
                compactName.contains("futura") || compactName.contains("verwaltung") ||
                compactName.contains("manager") || compactName.contains("communication") ||
                compactName.contains("kommunikation");
        boolean versionNamed = compactName.matches(".*(v[0-9]+([._-][0-9]+)*|20[0-9]{2}[-_.][0-9]{1,2}[-_.][0-9]{1,2}|backup|sicherung|alt|old|komplett|zusammengefuehrt).*");
        return developmentFolder || kcNamed || (projectNamed && versionNamed);
    }

    private boolean isDirectDownloadFile(File file) {
        if (file == null || !file.isFile()) return false;
        File parent = file.getParentFile();
        File downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (parent == null || downloads == null) return false;
        return parent.getAbsolutePath().equalsIgnoreCase(downloads.getAbsolutePath());
    }

    private boolean isAutoDeleteSafe(Candidate c) {
        if (c == null || c.risk == Risk.RED) return false;

        String reason = c.reason == null ? "" : c.reason;
        if (reason.startsWith("KC-Entwicklungsarchiv")) {
            return isKcDevelopmentArchive(c.file);
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
                "• KC-/Entwicklungsarchive (ZIP/RAR/7Z/TAR/GZ/TGZ/BZ2/XZ) im Download-Baum, unabhängig vom Alter\n" +
                "• alte ZIP/RAR/7Z/TAR/GZ-Archive direkt im Download-Ordner\n" +
                "• byte-identische Dubletten direkt im Download-Ordner, wenn eine andere Kopie erhalten bleibt\n\n" +
                "Entpackte KC-Projektordner, WhatsApp, DCIM/Kamera, Pictures/Bilder, Documents, Orbit sowie APK/AAB-Dateien bleiben geschützt.\n\n" +
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
            int ok = 0, fail = 0;
            long freed = 0;
            for (int p : selected) {
                if (p < 0 || p >= candidates.size()) continue;
                Candidate c = candidates.get(p);
                if (deleteRecursive(c.file)) { ok++; freed += c.size; }
                else fail++;
            }
            int okF = ok, failF = fail;
            long freedF = freed;
            runOnUiThread(() -> {
                progress.setVisibility(View.GONE);
                Toast.makeText(this, "Gelöscht: " + okF + " · freigegeben ca. " + Formatter.formatFileSize(this, freedF) + (failF > 0 ? " · Fehler: " + failF : ""), Toast.LENGTH_LONG).show();
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
