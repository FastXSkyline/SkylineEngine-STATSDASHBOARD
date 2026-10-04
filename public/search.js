const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const initialQuery=params.get("q")||"";
const initialMode=["everything","users","all-users","investigate"].includes(params.get("mode"))?params.get("mode"):"users";
const initialUser=params.get("user")||"";
const MODE_HELP={
  everything:"Show every matching telemetry record",
  users:"Show each matching user once",
  investigate:"Show the matching activity log in detail",
  "all-users":"Show every unique user in the database"
};
let currentMode=initialMode;

function esc(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function ago(v){if(!v)return"—";const d=new Date(String(v).includes("T")?v:String(v).replace(" ","T")+"Z");if(Number.isNaN(d.getTime()))return v;const s=Math.max(0,Math.floor((Date.now()-d)/1000));if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+"m ago";if(s<86400)return Math.floor(s/3600)+"h ago";return Math.floor(s/86400)+"d ago"}
function state(title,msg){$("state").hidden=false;$("state").innerHTML='<div class="state-icon">⌕</div><strong>'+esc(title)+'</strong><span>'+esc(msg)+'</span>';$("results").innerHTML=""}

function setMode(mode){
  currentMode=mode;
  document.querySelectorAll(".mode-btn").forEach(btn=>btn.classList.toggle("active",btn.dataset.mode===mode));
  $("modeHelp").textContent=MODE_HELP[mode];
}

function render(rows,q,data){
  $("summary").hidden=false;
  $("matchCount").textContent=Number(data.total??rows.length).toLocaleString();
  $("userCount").textContent=new Set(rows.map(r=>String(r.userId))).size.toLocaleString();
  $("platformCount").textContent=new Set(rows.map(r=>String(r.os||"unknown"))).size.toLocaleString();
  $("latestEvent").textContent=rows[0]?.event||"—";
  $("resultTitle").textContent=currentMode==="all-users"?"All users":'Matches for "'+q+'"';
  $("resultCount").textContent=rows.length+(rows.length===1?" record":" records");
  $("state").hidden=true;

  if(!rows.length){
    state("No matching telemetry","Try a user name, ID, session ID, GPU, CPU, OS, or application version.");
    return;
  }

  $("results").innerHTML=rows.map(r=>{
    const matchedLogs=currentMode==="users"&&r.matchedLogs>1
      ? '<span class="tag muted-tag">'+esc(r.matchedLogs)+" logs</span>"
      : "";
    const investigateHint=(currentMode==="users"||currentMode==="all-users")
      ? '<div class="user-actions"><span class="user-once">Latest matching event · '+esc(r.matchedLogs||1)+' matching logs</span><button type="button" class="investigate-btn" data-user-id="'+esc(r.userId||"")+'">Investigate user →</button></div>'
      : "";
    return '<article class="result-row"><div class="result-main"><div class="result-title"><strong>'+esc(r.userName||"Unknown user")+'</strong><span class="tag">'+esc(r.event||"launch")+'</span>'+matchedLogs+'</div><div class="result-id">'+esc(r.userId||"No user ID")+'</div><div class="chips"><span>'+esc(r.os)+" "+esc(r.osVersion)+'</span><span>'+esc(r.appVersion||"unknown")+'</span><span>'+esc(r.screen||"resolution unknown")+'</span></div>'+investigateHint+'</div><div class="hardware"><div><small>CPU</small><b>'+esc(r.cpuModel||"Unknown")+'</b></div><div><small>GPU</small><b>'+esc(r.gpuModel||"Unknown")+'</b></div></div><div class="result-meta"><span>'+esc(r.sessionId||"No session")+'</span><time>'+ago(r.createdAt)+'</time></div></article>'
  }).join("");

  if(data.truncated&&(currentMode==="investigate"||currentMode==="all-users")){
    $("results").insertAdjacentHTML("beforeend",'<div class="search-limit">Showing the latest '+Number(data.limit||500).toLocaleString()+' matching logs. Use a more specific user ID/name to narrow the investigation.</div>');
  }
}

async function search(q,userId=""){
  $("resultTitle").textContent="Searching…";
  $("resultCount").textContent="";
  state("Analyzing telemetry",MODE_HELP[currentMode]+".");
  try{
    const userParam=userId?"&user="+encodeURIComponent(userId):"";
    const searchLimit=currentMode==="investigate"?500:currentMode==="everything"?1000:100;
    const res=await fetch("/api/search?q="+encodeURIComponent(q)+"&mode="+encodeURIComponent(currentMode)+"&limit="+searchLimit+userParam,{cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||"Search failed.");
    render(data.results||[],data.query||q,data);
    history.replaceState(null,"","/search.html?q="+encodeURIComponent(q)+"&mode="+encodeURIComponent(currentMode)+(userId?"&user="+encodeURIComponent(userId):""));
  }catch(e){
    $("summary").hidden=true;
    state("Search unavailable",e.message||"Could not query telemetry.")
  }
}

document.querySelectorAll(".mode-btn").forEach(btn=>btn.addEventListener("click",()=>{
  setMode(btn.dataset.mode);
  const q=$("query").value.trim();
  if(q||currentMode==="all-users")search(q);
}));

$("searchForm").addEventListener("submit",e=>{
  e.preventDefault();
  const q=$("query").value.trim();
  if(!q&&currentMode!=="all-users")return;
  search(q);
});

setMode(initialMode);
$("query").value=initialQuery;
if(initialQuery || initialUser || initialMode==="all-users")search(initialQuery,initialUser);

document.addEventListener("click",e=>{
  const button=e.target.closest(".investigate-btn");
  if(!button)return;
  const userId=button.dataset.userId||"";
  const q=$("query").value.trim();
  if(!userId)return;
  currentMode="investigate";
  setMode("investigate");
  search(q,userId);
});
