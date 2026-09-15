export function compareVersions(a,b){
  const A=parseVersion(a),B=parseVersion(b);
  if(!A||!B)return String(a).localeCompare(String(b),undefined,{numeric:true,sensitivity:'base'});
  for(let i=0;i<3;i++){if(A.core[i]!==B.core[i])return A.core[i]>B.core[i]?1:-1}
  if(!A.pre.length&&!B.pre.length)return 0;
  if(!A.pre.length)return 1;
  if(!B.pre.length)return-1;
  const n=Math.max(A.pre.length,B.pre.length);
  for(let i=0;i<n;i++){
    if(i>=A.pre.length)return-1;
    if(i>=B.pre.length)return 1;
    const x=A.pre[i],y=B.pre[i];
    if(x===y)continue;
    const xn=/^\d+$/.test(x),yn=/^\d+$/.test(y);
    if(xn&&yn)return Number(x)>Number(y)?1:-1;
    if(xn!==yn)return xn?-1:1;
    return x>y?1:-1;
  }
  return 0;
}
export function isNewerVersion(candidate,current){return compareVersions(candidate,current)>0}
function parseVersion(value){
  const m=String(value||'').trim().replace(/^v/i,'').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if(!m)return null;
  return{core:[Number(m[1]),Number(m[2]),Number(m[3])],pre:m[4]?m[4].split('.'):[]};
}
