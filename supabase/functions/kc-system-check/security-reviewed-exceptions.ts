type Finding={object_schema?:string;object_name?:string;finding_code?:string;[key:string]:unknown};
type Review={object_schema?:string;object_name?:string;finding_code?:string;decision?:string;reason?:string;reviewed_at?:string;review_after?:string;active?:boolean};

const key=(x:{object_schema?:string;object_name?:string;finding_code?:string})=>`${x.object_schema||"public"}\u0000${x.object_name||""}\u0000${x.finding_code||""}`;

export function classifyReviewedSecurityFindings(findings:Finding[],reviews:Review[],now=Date.now()){
  const accepted=new Map<string,Review>();
  for(const r of Array.isArray(reviews)?reviews:[]){
    if(r?.active!==true||!["accepted_required","accepted_temporary"].includes(String(r.decision||"")))continue;
    if(!r.object_name||!r.finding_code)continue;
    if(r.review_after){const t=Date.parse(r.review_after);if(!Number.isFinite(t)||t<=now)continue;}
    accepted.set(key(r),r);
  }
  const all=(Array.isArray(findings)?findings:[]).map(f=>{
    const r=accepted.get(key(f));
    return r?{...f,reviewed_exception:true,review_decision:r.decision,review_reason:r.reason||"",reviewed_at:r.reviewed_at||null,review_after:r.review_after||null}:{...f,reviewed_exception:false};
  });
  return{all,actionable:all.filter(x=>!x.reviewed_exception),reviewed:all.filter(x=>x.reviewed_exception)};
}

export async function loadReviewedSecurityExceptions(own:string,service:string):Promise<Review[]>{
  try{
    const url=`${own}/rest/v1/kc_security_reviewed_exceptions?select=object_schema,object_name,finding_code,decision,reason,reviewed_at,review_after,active&active=eq.true`;
    const r=await fetch(url,{cache:"no-store",headers:{apikey:service,Authorization:`Bearer ${service}`}});
    if(!r.ok)return[]; // fail-open: no registry means no finding is suppressed
    const data=await r.json();return Array.isArray(data)?data:[];
  }catch{return[]}
}
