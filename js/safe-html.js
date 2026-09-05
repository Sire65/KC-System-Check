const MAX_DEPTH=12;
const MAP={"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"};

export function esc(value){
  if(value===null||value===undefined)return"";
  return String(value).replace(/[&<>"']/g,c=>MAP[c]);
}

export function sanitizeDeep(value,{keepRaw=[],depth=0}={}){
  if(depth>MAX_DEPTH)return null;
  if(typeof value==="string")return esc(value);
  if(Array.isArray(value))return value.map(v=>sanitizeDeep(v,{keepRaw,depth:depth+1}));
  if(value&&typeof value==="object"){
    const out={};
    for(const [key,val] of Object.entries(value))out[key]=keepRaw.includes(key)?val:sanitizeDeep(val,{keepRaw,depth:depth+1});
    return out;
  }
  return value;
}
