
const PDFJS_VERSION='4.10.38';
let pdfjsLib;
try{
  pdfjsLib=await import(`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`);
  pdfjsLib.GlobalWorkerOptions.workerSrc=`https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
}catch(e){console.error(e)}
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const clean=s=>String(s??'').replace(/[ \t]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
const flat=s=>clean(s).replace(/\s*\n\s*/g,' ');
const rxesc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const wc=s=>(String(s).trim().match(/\b[\w’'-]+\b/g)||[]).length;
let docs=[], primary=null;

const signalDefs=[
  {id:'sizeGrowth',label:'Industry size and five-year growth trajectory',primaryOnly:true,keys:['revenue','cagr','five-year growth','5-year growth','forecast','performance snapshot']},
  {id:'regulation',label:'Regulatory or compliance pressure',keys:['regulation','policy','regulatory','compliance','antitrust','copyright','privacy','cybersecurity','intellectual property','data protection']},
  {id:'supply',label:'Supply chain concentration or fragility',keys:['supplier power','supplier','cloud','data center','infrastructure','gpu','computing','talent','skilled workers','third-party','dependency','dependencies']},
  {id:'customers',label:'Customer concentration or fragmentation',primaryOnly:true,keys:['major markets','market segmentation','customers','buyers','customer class concentration','largest customer group']},
  {id:'trend',label:'Biggest trend over the next five years',primaryOnly:true,keys:['outlook','next five years','over the next five years','ai','artificial intelligence','generative','cloud','innovation','will increasingly']},
  {id:'threat',label:'Biggest threat over the next five years',primaryOnly:true,keys:['threat','over the next five years','open-source','competition','substitutes','cybersecurity','risk','pressure','challenge']}
];

function sectionFor(text){
  const checks=[
    ['Regulation & Policy',/regulation\s*&\s*policy/i],['Buyer & Supplier Power',/buyer\s*&\s*supplier power/i],
    ['Major Markets',/major markets/i],['Market Share',/market share/i],['Competitive Forces',/competitive forces/i],
    ['Outlook',/\boutlook\b/i],['Innovations',/\binnovations?\b/i],['Performance',/\bperformance\b/i],
    ['At a Glance',/at a glance/i],['About This Industry',/about this industry/i],['Companies',/\bcompanies\b/i]
  ];
  for(const [n,r] of checks)if(r.test(text))return n; return 'Report page';
}
function printedPage(text,pdfPage){
  const m=flat(text).match(/(?:US|Industry|Publishing|Developers)\s+(\d{1,2})\s+www\.ibisworld\.com/i) ||
          flat(text).match(/\b(\d{1,2})\s+www\.ibisworld\.com\b/i);
  return m?m[1]:null;
}
function reportTitleFromName(name){return name.replace(/\.pdf$/i,'').replace(/^[A-Z0-9]+\s+/,'').trim()}
function citation(e){
  if(!e)return '';
  const pp=e.printed?`report p. ${e.printed}`:`PDF p. ${e.page}`;
  return `${e.title || e.doc}, ${pp}, ${e.section||'Report page'}`;
}
function renderSignals(){
 $('signals').innerHTML=signalDefs.map(s=>`<div class="signal">
 <div class="signal-head"><h3>${esc(s.label)}</h3><span id="conf-${s.id}" class="conf low">not run</span></div>
 <div class="grid" style="margin-top:9px">
   <div class="c8"><label>Final finding</label><textarea id="val-${s.id}" placeholder="Pipeline result; review/edit before export."></textarea></div>
   <div class="c4"><label>Source</label><textarea id="src-${s.id}" placeholder="Report, page, section"></textarea></div>
 </div><div id="ev-${s.id}"></div></div>`).join('');
}
function renderCompetitorRows(rows=[]){
  const use=[...rows];
  while(use.length<5)use.push({});
  $('competitors').innerHTML=use.slice(0,5).map((r,i)=>`<tr>
    <td><input id="compName${i}" value="${esc(r.name||'')}"></td>
    <td><input id="compShare${i}" value="${esc(r.share||'')}" placeholder="Not reported"></td>
    <td><textarea id="compWhy${i}" style="min-height:62px">${esc(r.why||'')}</textarea></td>
    <td><textarea id="compSrc${i}" style="min-height:62px">${esc(r.source||'')}</textarea></td>
  </tr>`).join('');
  hookAuditInputs();
}
renderSignals();renderCompetitorRows();

const drop=$('drop'), fi=$('fileInput');
drop.onclick=()=>fi.click();
drop.ondragover=e=>{e.preventDefault();drop.classList.add('drag')};
drop.ondragleave=()=>drop.classList.remove('drag');
drop.ondrop=e=>{e.preventDefault();drop.classList.remove('drag');addFiles([...e.dataTransfer.files])};
fi.onchange=()=>addFiles([...fi.files]);
$('clear').onclick=()=>{docs=[];primary=null;renderFiles();$('reportSelection').innerHTML='<span class="muted">Run the pipeline after uploading reports.</span>';};

async function addFiles(files){
 for(const file of files.filter(f=>f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'))){
   if(docs.some(d=>d.name===file.name&&d.size===file.size))continue;
   const d={name:file.name,size:file.size,file,status:'queued',pages:[],title:reportTitleFromName(file.name)};
   docs.push(d); renderFiles(); await parsePdf(d);
 } renderFiles();
}
function renderFiles(){
 $('files').innerHTML=docs.length?docs.map(d=>`<div class="file"><span><strong>${esc(d.name)}</strong> <span class="muted">${(d.size/1048576).toFixed(2)} MB</span></span><span class="${d.status==='ready'?'ok':d.status==='error'?'bad':'warn'}">${d.status==='ready'?`${d.pages.length} pages parsed`:esc(d.status)}</span></div>`).join(''):'<div class="muted" style="font-size:13px;margin-top:8px">No reports loaded.</div>';
}
async function parsePdf(d){
 if(!pdfjsLib){d.status='error';renderFiles();return}
 d.status='parsing…';renderFiles();
 try{
  const buf=await d.file.arrayBuffer(), pdf=await pdfjsLib.getDocument({data:buf}).promise;
  for(let p=1;p<=pdf.numPages;p++){
    const pg=await pdf.getPage(p), tc=await pg.getTextContent();
    let txt=''; for(const item of tc.items){txt+=item.str+(item.hasEOL?'\n':' ')}
    txt=clean(txt); d.pages.push({page:p,text:txt,printed:printedPage(txt,p),section:sectionFor(txt)});
  }
  const first=d.pages.slice(0,2).map(x=>flat(x.text)).join(' ');
  const code=first.match(/Information\s*[•·]\s*([A-Z0-9]+)/i); if(code)d.ibisCode=code[1];
  const titleLine=first.match(/Information\s*[•·]\s*[A-Z0-9]+\s+(.+?)(?:\s+(?:Still|System|In development|Published:|20\d{2}\s+IBISWorld))/i);
  if(titleLine)d.title=clean(titleLine[1]);
  d.status='ready';
 }catch(e){console.error(e);d.status='error'}
 renderFiles();
}
function pageObjects(d){return d.pages.map(p=>({...p,doc:d.name,title:d.title}))}
function allPages(ds=docs){return ds.flatMap(pageObjects)}
function pageEvidence(p,snippet){return {doc:p.doc,title:p.title,page:p.page,printed:p.printed,section:p.section,snippet:flat(snippet||p.text)}}
function around(text,index,len=700){const f=flat(text);return f.slice(Math.max(0,index-240),Math.min(f.length,index+len))}
function companyMetrics(d,company){
 const low=company.toLowerCase(), re=new RegExp(`\\b${rxesc(company)}\\b`,'ig');
 let mentions=0, listed=false, major=false, share=null, shareEv=null;
 for(const p of d.pages){
   const f=flat(p.text); const m=f.match(re); mentions+=m?m.length:0;
   if(/What.?s Included|Companies/i.test(f) && new RegExp(`\\b${rxesc(company)}\\b`,'i').test(f))listed=true;
   if(/Major Players|Market Share/i.test(f) && new RegExp(`\\b${rxesc(company)}\\b`,'i').test(f))major=true;
   const idx=f.search(new RegExp(`\\b${rxesc(company)}\\b`,'i'));
   if(idx>=0 && /Major Players|Market Share/i.test(f)){
     const sn=around(f,idx,260);
     const after=sn.slice(Math.max(0,sn.toLowerCase().indexOf(company.toLowerCase())+company.length));
     const nums=[...after.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map(x=>Number(x[1]));
     if(nums.length){share=nums[0];shareEv=pageEvidence({...p,doc:d.name,title:d.title},sn)}
     else{
       const compact=after.match(/^\s*(?:\$?\s*)?(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s|$)/);
       if(compact){share=Number(compact[2]);shareEv=pageEvidence({...p,doc:d.name,title:d.title},sn)}
     }
   }
 }
 const score=(share!=null?45+Math.min(share,35):0)+(listed?18:0)+(major?12:0)+Math.min(mentions,12);
 return {mentions,listed,major,share,shareEv,score};
}
function selectPrimary(company){
 const ranked=docs.filter(d=>d.status==='ready').map(d=>({d,...companyMetrics(d,company)})).sort((a,b)=>b.score-a.score);
 primary=ranked[0]?.d||null;
 if(primary) primary.metrics=ranked[0];
 $('reportSelection').innerHTML=ranked.length?ranked.map((r,i)=>`<div class="report-card ${i===0?'primary':''}">
  <div class="row"><span class="pill ${i===0?'primary':''}">${i===0?'PRIMARY':'ALTERNATIVE'}</span><strong>${esc(r.d.title)}</strong><span class="muted">${esc(r.d.ibisCode||'')}</span><span class="score">${r.score.toFixed(0)}</span></div>
  <div class="reason">${r.share!=null?`Company market share found: ${r.share}% · `:''}${r.listed?'Listed in report company set · ':''}${r.major?'Appears in Major Players/Market Share section · ':''}${r.mentions} company-name mentions detected.</div>
 </div>`).join(''):'No parsed reports.';
 if(ranked.length){
  const top=ranked[0], alt=ranked[1];
  $('method').value=`The pipeline reviewed ${ranked.length} uploaded industry report${ranked.length===1?'':'s'} and selected “${top.d.title}” as the primary industry for ${company}. The selection score prioritizes explicit company market share, appearance in the report’s company/major-player sections, and repeated company-specific evidence. ${top.share!=null?`${company} has a reported ${top.share}% share in this report, which is strong direct evidence of competitive relevance. `:''}${alt?`The next-closest uploaded alternative was “${alt.d.title}” (score ${alt.score.toFixed(0)} versus ${top.score.toFixed(0)}), so it is treated as supplemental rather than blended into primary-market statistics.`:'No alternative report was available for comparison.'}`;
  if(alt && top.score-alt.score<8)$('method').value+=` Because the top two scores are close, the industry choice should be treated as a close call and reviewed manually.`;
 }
 return ranked;
}

function bestPages(keys,ds,limit=5,bonusSections=[]){
 const arr=[];
 for(const p of allPages(ds)){
   const f=flat(p.text).toLowerCase(); let score=0;
   for(const k of keys){const n=f.split(k.toLowerCase()).length-1;score+=Math.min(n,5)*(k.includes(' ')?3:1.4)}
   if(bonusSections.some(s=>p.section.toLowerCase().includes(s.toLowerCase())))score+=9;
   if(score>0)arr.push({...pageEvidence(p),score});
 }
 return arr.sort((a,b)=>b.score-a.score).slice(0,limit);
}
function evidenceSnippet(e,keys){
 let best=e.snippet;
 const f=e.snippet; let bestScore=-1;
 const sentences=f.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
 for(let i=0;i<sentences.length;i++){
   const w=[sentences[i-1],sentences[i],sentences[i+1]].filter(Boolean).join(' ');
   let s=0; const l=w.toLowerCase();
   for(const k of keys)if(l.includes(k.toLowerCase()))s+=k.includes(' ')?4:2;
   if(/\$?\d+(?:\.\d+)?\s*(?:%|bn|billion|million|m)?/i.test(w))s+=2;
   if(s>bestScore){best=w;bestScore=s}
 }
 return flat(best).slice(0,680);
}
function renderEvidence(id,ev,keys,onUse){
 const el=$(id);
 if(!ev.length){el.innerHTML=`<div class="evidence"><span class="bad">Not found in provided sources.</span></div>`;return}
 el.innerHTML=ev.map((e,i)=>`<div class="evidence"><div class="src">${esc(citation(e))}</div><div class="snippet">${esc(evidenceSnippet(e,keys))}</div><button class="small" data-i="${i}">Use evidence</button></div>`).join('');
 el.querySelectorAll('button').forEach(b=>b.onclick=()=>onUse(ev[Number(b.dataset.i)]));
}
function setConf(id,n){const el=$('conf-'+id);let c=n>=3?'high':n?'med':'low';el.className='conf '+c;el.textContent=n>=3?'strong evidence':n?'review':'not found'}

function extractNaics(){
 if(!primary)return;
 const candidates=[];
 for(const p of primary.pages){
   const f=flat(p.text);
   for(const m of f.matchAll(/2022\s+(\d{6})\s*[–—-]\s*([A-Za-z][A-Za-z &(),.-]+)/g)){
     candidates.push({...pageEvidence({...p,doc:primary.name,title:primary.title},around(f,m.index,330)),code:m[1],title:m[2].trim(),score:20});
   }
 }
 const best=candidates.find(x=>x.code.length===6)||candidates[0];
 $('ibisCode').value=primary.ibisCode||'';
 if(best){$('naicsCode').value=best.code;$('naicsTitle').value=best.title;$('naicsSource').value=citation(best)}
 $('naicsWhy').value=`The selected NAICS classification matches the primary report’s official 2022 NAICS listing and the report’s industry definition; an alternative classification should be used only if the company’s primary activity is better described by another official Census industry definition.`;
 renderEvidence('naicsEvidence',candidates.slice(0,4),['2022','naics'],e=>{$('naicsCode').value=e.code;$('naicsTitle').value=e.title;$('naicsSource').value=citation(e);updateAudit()});
 const c=$('naicsCode').value;$('censusLink').href=c?`https://www.census.gov/naics/?input=${encodeURIComponent(c)}&year=2022`:'https://www.census.gov/naics/';
}

function extractSizeGrowth(){
 if(!primary)return {value:'',source:'',ev:[]};
 const ev=bestPages(['revenue','cagr','forecast'],[primary],6,['At a Glance','Performance','Outlook']);
 let data=null;
 for(const e of ev){
   const f=flat(e.snippet);
   const rev=f.match(/Revenue\s+\$?\s*(\d+(?:\.\d+)?)\s*(bn|billion|m|million)/i);
   const rates=[...f.matchAll(/(20\d{2})\s*[-–]\s*(\d{2,4})\s+[^%]{0,15}?(\d+(?:\.\d+)?)\s*%/g)];
   if(rev && rates.length>=2){data={rev:`$${rev[1]}${rev[2].toLowerCase().startsWith('b')?'bn':'m'}`,r1:rates[0],r2:rates[1],e};break}
 }
 if(data){
   const endYear=String(data.r2[2]).length===2?String(data.r2[1]).slice(0,2)+data.r2[2]:data.r2[2];
   const value=`${primary.title} reports current industry revenue of ${data.rev}. Historical five-year revenue CAGR was ${data.r1[3]}% for ${data.r1[1]}–${data.r1[2]}, and forecast five-year CAGR is ${data.r2[3]}% for ${data.r2[1]}–${endYear}.`;
   return {value,source:citation(data.e),ev};
 }
 return {value:ev.length?evidenceSnippet(ev[0],signalDefs[0].keys):'',source:ev[0]?citation(ev[0]):'',ev};
}
function parseMajorMarkets(){
 if(!primary)return null;
 const pages=bestPages(['major markets segmentation','industry revenue'],[primary],8,['Major Markets']);
 for(const e of pages){
   const f=flat(e.snippet);
   if(!/Major Markets Segmentation/i.test(f))continue;
   const pairs=[...f.matchAll(/([A-Z][A-Za-z,&'’ /-]{2,70})\s*\(\$?[\d,.]+\s*(?:bn|m|million|billion)?\)\s*(\d+(?:\.\d+)?)%/g)]
     .map(m=>({segment:clean(m[1]),share:m[2]}));
   if(pairs.length>=2)return {pairs,e};
 }
 return null;
}
function buyerPowerText(){
 const ev=bestPages(['buyer power','customer class concentration','major markets'],[primary],5,['Buyer & Supplier Power','Major Markets']);
 return ev;
}
function supplierPowerText(){
 const ev=bestPages(['supplier power','supplier','cloud','infrastructure','talent'],docs,6,['Buyer & Supplier Power']);
 return ev;
}
function regulationText(){
 let ev=bestPages(signalDefs.find(s=>s.id==='regulation').keys,[primary],5,['Regulation & Policy']);
 if(ev.length<2)ev=[...ev,...bestPages(signalDefs.find(s=>s.id==='regulation').keys,docs.filter(d=>d!==primary),3,['Regulation & Policy'])];
 return ev.slice(0,5);
}
function trendText(){return bestPages(['over the next five years','will increasingly','outlook','artificial intelligence','ai','generative','innovation'],[primary],6,['Outlook','Innovations'])}
function threatText(){return bestPages(['threat','over the next five years','open-source','substitutes','competition','risk','cybersecurity'],[primary],6,['Outlook','Competitive Forces'])}

function autoSignal(id,value,source,ev,keys){
 $('val-'+id).value=value||'Not found in provided sources.';
 $('src-'+id).value=source||'Not found in provided sources.';
 setConf(id,ev?.length||0);
 renderEvidence('ev-'+id,ev||[],keys,e=>{$('val-'+id).value=evidenceSnippet(e,keys);$('src-'+id).value=citation(e);updateAudit()});
}
function competitorCandidates(company){
 if(!primary)return [];
 const candidates=new Map();
 for(const p of primary.pages){
   const f=flat(p.text);
   if(!/Major Players|Market Share|Companies/i.test(f))continue;
   for(const m of f.matchAll(/([A-Z][A-Za-z0-9&.'’\-]+(?:\s+[A-Z][A-Za-z0-9&.'’\-]+){0,4})\s+(?:\$?[\d,.]+\s+)?(\d+(?:\.\d+)?)\s*%/g)){
     const name=clean(m[1]); if(name.toLowerCase()===company.toLowerCase()||/other companies/i.test(name))continue;
     if(name.length<3)continue;
     candidates.set(name,{name,share:m[2]+'%',why:'Named in the primary report’s market-share/major-player evidence.',source:citation(pageEvidence({...p,doc:primary.name,title:primary.title},around(f,m.index,300))),score:50});
   }
 }
 for(const p of primary.pages){
   const f=flat(p.text); if(!/Companies/i.test(f))continue;
   const idx=f.indexOf('Companies'); if(idx<0)continue;
   const segment=f.slice(idx,Math.min(f.length,idx+1200));
   const names=[...segment.matchAll(/(?:•\s*)?([A-Z][A-Za-z0-9&.'’\-]+(?:\s+[A-Z][A-Za-z0-9&.'’\-]+){0,3})(?=\s+(?:•|Information|Related|$))/g)].map(m=>clean(m[1]));
   for(const name of names){
     if(!name||name.toLowerCase()===company.toLowerCase()||/companies|information|industry|related|publishing/i.test(name))continue;
     if(!candidates.has(name))candidates.set(name,{name,share:'Not reported',why:'Listed as a company in the selected primary industry report.',source:citation(pageEvidence({...p,doc:primary.name,title:primary.title},segment.slice(0,650))),score:10});
   }
 }
 const compPages=bestPages(['competition','challenger','competitor','open-source','market share'],[primary],8,['Competitive Forces','Outlook']);
 for(const e of compPages){
   const text=e.snippet;
   const proper=[...text.matchAll(/\b([A-Z][A-Za-z0-9.'’\-]+(?:\s+[A-Z][A-Za-z0-9.'’\-]+){0,2})\b/g)].map(m=>m[1]);
   for(const name of proper){
     if(name.toLowerCase()===company.toLowerCase())continue;
     if(/Source|Industry|Revenue|Market|United States|IBISWorld|Information|Software|Publishing|Companies|Company|Over|The|This|These|Adobe's|CAGR/i.test(name))continue;
     const count=primary.pages.reduce((n,p)=>n+(flat(p.text).match(new RegExp(`\\b${rxesc(name)}\\b`,'g'))||[]).length,0);
     if(count>=2){
       const cur=candidates.get(name);
       if(cur){cur.score+=Math.min(count,10)}
       else candidates.set(name,{name,share:'Not reported',why:'Discussed repeatedly in competition/outlook evidence from the primary report.',source:citation(e),score:Math.min(count,10)});
     }
   }
 }
 return [...candidates.values()].sort((a,b)=>b.score-a.score).slice(0,5);
}

function runPipeline(){
 const company=$('company').value.trim();
 $('runStatus').style.display='inline-block';
 if(!company){$('runStatus').textContent='Enter a company name.';return}
 const ready=docs.filter(d=>d.status==='ready');
 if(!ready.length){$('runStatus').textContent='Upload at least one PDF and wait for parsing to finish.';return}
 $('runStatus').textContent='Running report selection and extraction…';
 selectPrimary(company);
 if(!primary){$('runStatus').textContent='Could not select a primary report.';return}
 extractNaics();

 const sg=extractSizeGrowth(); autoSignal('sizeGrowth',sg.value,sg.source,sg.ev,signalDefs[0].keys);

 const reg=regulationText(); autoSignal('regulation',reg.length?`The uploaded evidence indicates regulatory/compliance pressure around ${/antitrust/i.test(reg[0].snippet)?'antitrust and competition policy':/cyber/i.test(reg[0].snippet)?'cybersecurity and data protection':'industry regulation, policy and compliance'}. Review the cited excerpt and keep only pressures explicitly supported by the report.`:'Not found in provided sources.',reg[0]?citation(reg[0]):'',reg,signalDefs.find(s=>s.id==='regulation').keys);

 const sup=supplierPowerText();
 let supVal='Not found in provided sources.';
 if(sup.length){
   const direct=flat(sup[0].snippet).match(/Supplier Power\s+(Low|Moderate|High)(?:\s+(Steady|Increasing|Decreasing))?/i);
   supVal=direct?`IBISWorld rates supplier power as ${direct[1]}${direct[2]?` and ${direct[2].toLowerCase()}`:''}. The report also discusses technology, infrastructure and talent dependencies; use the cited evidence to describe fragility without assuming that dependency automatically means supplier concentration.`:
   `The reports identify software-industry dependencies such as cloud/infrastructure, computing resources or specialized talent. However, supplier concentration should be stated only where the cited evidence directly supports it.`;
 }
 autoSignal('supply',supVal,sup[0]?citation(sup[0]):'',sup,signalDefs.find(s=>s.id==='supply').keys);

 const mm=parseMajorMarkets(), custEv=buyerPowerText();
 let custVal='Not found in provided sources.', custSrc='';
 if(mm){
   custVal=`Customer demand is spread across ${mm.pairs.length} reported market segments. `+mm.pairs.slice(0,6).map(x=>`${x.segment} (${x.share}%)`).join(', ')+`. Assess concentration from this distribution rather than from company-level customer anecdotes.`;
   custSrc=citation(mm.e); custEv.unshift(mm.e);
 }
 autoSignal('customers',custVal,custSrc,custEv,signalDefs.find(s=>s.id==='customers').keys);

 const tr=trendText(); let trVal=tr.length?evidenceSnippet(tr[0],signalDefs.find(s=>s.id==='trend').keys):'Not found in provided sources.';
 if(tr.length && /artificial intelligence|\bAI\b|generative/i.test(tr.slice(0,3).map(x=>x.snippet).join(' ')))trVal=`Analyst interpretation: AI-enabled product and workflow transformation is the strongest five-year trend in the selected report. Source evidence emphasizes continued AI integration, automation and accelerated creative/productivity workflows.`;
 autoSignal('trend',trVal,tr[0]?citation(tr[0]):'',tr,signalDefs.find(s=>s.id==='trend').keys);

 const th=threatText(); let thVal=th.length?evidenceSnippet(th[0],signalDefs.find(s=>s.id==='threat').keys):'Not found in provided sources.';
 if(th.length && /open-source|open source/i.test(th.slice(0,3).map(x=>x.snippet).join(' ')))thVal=`Analyst interpretation: intensifying free/open-source competition is the strongest structural threat identified in the selected report because it can pressure pricing, market share and switching behavior while narrowing functional gaps with proprietary tools.`;
 autoSignal('threat',thVal,th[0]?citation(th[0]):'',th,signalDefs.find(s=>s.id==='threat').keys);

 const comps=competitorCandidates(company);renderCompetitorRows(comps);
 $('compConf').className='conf '+(comps.length>=3?'high':comps.length?'med':'low');$('compConf').textContent=comps.length>=3?'3–5 competitors found':comps.length?'review':'not found';
 const ce=bestPages(['major players','market share','competition','challenger'],[primary],6,['Market Share','Competitive Forces']);
 renderEvidence('compEvidence',ce,['market share','competition'],e=>{const i=[0,1,2,3,4].find(i=>!$('compSrc'+i)?.value);if(i!==undefined)$('compSrc'+i).value=citation(e);updateAudit()});

 refreshMissing();
 $('runStatus').textContent=`Done. Selected “${primary.title}” from ${ready.length} uploaded report${ready.length===1?'':'s'}. Review evidence and edit any synthesis before export.`;
 updateAudit();
}
$('run').onclick=runPipeline;

function currentData(){
 const signals={};for(const s of signalDefs)signals[s.id]={label:s.label,value:$('val-'+s.id).value.trim(),source:$('src-'+s.id).value.trim()};
 const competitors=[0,1,2,3,4].map(i=>({name:$('compName'+i)?.value.trim()||'',share:$('compShare'+i)?.value.trim()||'',why:$('compWhy'+i)?.value.trim()||'',source:$('compSrc'+i)?.value.trim()||''})).filter(x=>x.name||x.share||x.source);
 return {
  company:$('company').value.trim(),analyst:$('analyst').value.trim(),tool_link:location.protocol.startsWith('http')?location.href.split('#')[0]:'[PASTE PUBLIC WORKING TOOL LINK HERE]',
  generated:new Date().toLocaleString(),primary_report:primary?.title||'',primary_code:primary?.ibisCode||'',method:$('method').value.trim(),method_limits:$('methodLimits').value.trim(),
  naics:{ibis:$('ibisCode').value.trim(),code:$('naicsCode').value.trim(),title:$('naicsTitle').value.trim(),source:$('naicsSource').value.trim(),neighbor:$('neighborCode').value.trim(),neighbor_title:$('neighborTitle').value.trim(),why:$('naicsWhy').value.trim()},
  signals,competitors,missing:$('missing').value.trim(),reflection:$('reflection').value.trim(),reports:docs.map(d=>({title:d.title,name:d.name,pages:d.pages.length,status:d.status}))
 }
}
function refreshMissing(){
 const d=currentData(), miss=[];
 for(const s of Object.values(d.signals))if(!s.value||!s.source||/Not found in provided sources/i.test(s.value)||/Not found in provided sources/i.test(s.source))miss.push(s.label);
 const shares=d.competitors.filter(c=>c.name&&c.share&&!/not reported/i.test(c.share)).length;
 if(d.competitors.filter(c=>c.name).length<3)miss.push('three to five relevant competitors');
 if(shares<3)miss.push('market-share estimates for at least three competitors');
 if(!d.naics.neighbor)miss.push('a verified neighboring NAICS code / close-call classification');
 if(/cannot be confidently determined/i.test(d.signals.supply.value))miss.push('supplier concentration');
 $('missing').value=miss.length?`The current source set does not fully establish: ${[...new Set(miss)].join('; ')}. These items should remain explicit limitations rather than be guessed. To close the gaps, add a more targeted industry report, the U.S. Census NAICS manual for classification close calls, a company 10-K, regulator guidance, or supplier/customer concentration data as appropriate.`:'No required signal is currently blank. High-impact figures, the NAICS close call and analyst interpretations should still be checked against the cited original pages before submission.';
 updateAudit();
}
$('refreshMissing').onclick=refreshMissing;

function hookAuditInputs(){document.querySelectorAll('input,textarea').forEach(el=>{if(!el.dataset.audit){el.dataset.audit='1';el.addEventListener('input',updateAudit)}})}
hookAuditInputs();
$('reflection').addEventListener('input',()=>{const n=wc($('reflection').value);$('wordCount').textContent=`${n} / 250–500 words`;$('wordCount').className='word '+(n>=250&&n<=500?'pass':'fail')});
$('naicsCode').addEventListener('input',()=>{$('censusLink').href=$('naicsCode').value.trim()?`https://www.census.gov/naics/?input=${encodeURIComponent($('naicsCode').value.trim())}&year=2022`:'https://www.census.gov/naics/'});

function updateAudit(){
 const d=currentData(), sig=Object.values(d.signals), sourced=sig.filter(x=>x.value&&x.source&&!/not found in provided sources/i.test(x.source)).length;
 const comps=d.competitors.filter(c=>c.name&&c.source).length, compShares=d.competitors.filter(c=>c.name&&c.share&&!/not reported/i.test(c.share)).length;
 const ref=wc(d.reflection), checks=[
 ['Tool link',!d.tool_link.startsWith('['),'Public URL inserted'],
 ['Method',!!(d.method&&d.method_limits&&d.primary_report),'Primary choice + limits stated'],
 ['Traceability',sourced===signalDefs.length,`${sourced}/${signalDefs.length} required signals sourced`],
 ['Competitors',comps>=3,`${comps}/3 minimum sourced; ${compShares} exact shares`],
 ['NAICS',!!(d.naics.code&&d.naics.title&&d.naics.source&&d.naics.why),'Code + title + source + justification'],
 ['Missing intel',!!d.missing,'Limits documented'],
 ['Reflection',ref>=250&&ref<=500,`${ref} words`],
 ['Output complete',!!(d.signals.sizeGrowth.value&&d.signals.regulation.value&&d.signals.supply.value&&d.signals.customers.value&&d.signals.trend.value&&d.signals.threat.value),'All required sections populated']
 ];
 $('audit').innerHTML=checks.map(([n,ok,note])=>`<div><strong class="${ok?'pass':'fail'}">${ok?'✓':'○'} ${esc(n)}</strong>${esc(note)}</div>`).join('');
}
updateAudit();

function buildOutput(){
 const d=currentData(), sig=d.signals;
 const compRows=d.competitors.length?d.competitors.map(c=>`<tr><td>${esc(c.name)}</td><td>${esc(c.share||'Not reported')}</td><td>${esc(c.why)}</td><td>${esc(c.source)}</td></tr>`).join(''):'<tr><td colspan="4">Not found in provided sources.</td></tr>';
 $('output').innerHTML=`
 <h1>Industry Intelligence Pipeline Submission — ${esc(d.company||'Company')}</h1>
 <p><strong>Working tool:</strong> ${esc(d.tool_link)}</p>
 <p class="citation">This brief represents the actual output produced by the Industry Intelligence Pipeline using the uploaded industry reports.</p>

 <h2>2. Industry Intelligence Brief</h2>
 <h3>Industry Selection Method</h3><div class="methodbox">${esc(d.method||'Not yet generated.')}</div>
 <h3>Method Limitations</h3><div class="methodbox">${esc(d.method_limits)}</div>

 <h3>Industry Definition and NAICS</h3>
 <p><strong>Selected primary industry:</strong> ${esc(d.primary_report||'Not selected')}</p>
 <p><strong>IBISWorld industry code:</strong> ${esc(d.naics.ibis||'Not found')}</p>
 <p><strong>Official NAICS:</strong> ${esc(d.naics.code||'Not found')} — ${esc(d.naics.title||'')}</p>
 <p><strong>Why this classification rather than the alternative:</strong> ${esc(d.naics.why||'Not completed')}</p>
 <p class="citation"><strong>Source:</strong> ${esc(d.naics.source||'Not found in provided sources.')}${d.naics.neighbor?` | <strong>Alternative:</strong> ${esc(d.naics.neighbor)} — ${esc(d.naics.neighbor_title)}`:''}</p>

 ${signalDefs.map(s=>`<h3>${esc(sig[s.id].label)}</h3><p>${esc(sig[s.id].value||'Not found in provided sources.')}</p><p class="citation"><strong>Source:</strong> ${esc(sig[s.id].source||'Not found in provided sources.')}</p>`).join('')}

 <h3>Top 3–5 competitors & market share estimates</h3>
 <table><thead><tr><th>Competitor</th><th>Market share</th><th>Competitive relevance</th><th>Source</th></tr></thead><tbody>${compRows}</tbody></table>

 <h3>Missing Intelligence and Limits</h3><div class="missingbox">${esc(d.missing||'Not completed')}</div>

 <h3>Source Traceability Matrix</h3>
 <table><thead><tr><th>Required signal</th><th>Main finding</th><th>Source</th></tr></thead><tbody>
 <tr><td>Industry selection</td><td>${esc(d.primary_report)}</td><td>${esc(d.method)}</td></tr>
 <tr><td>NAICS</td><td>${esc(`${d.naics.code} — ${d.naics.title}`)}</td><td>${esc(d.naics.source)}</td></tr>
 ${signalDefs.map(s=>`<tr><td>${esc(sig[s.id].label)}</td><td>${esc(sig[s.id].value)}</td><td>${esc(sig[s.id].source)}</td></tr>`).join('')}
 <tr><td>Competitors / market shares</td><td>${esc(d.competitors.map(c=>`${c.name}: ${c.share||'Not reported'}`).join('; '))}</td><td>${esc(d.competitors.map(c=>c.source).filter(Boolean).join('; '))}</td></tr>
 </tbody></table>

 <h2>3. Reflection — 250–500 Words</h2>
 <p>${esc(d.reflection||'[PASTE YOUR REFLECTION HERE BEFORE FINAL EXPORT]')}</p>
 `;
}
$('preview').onclick=()=>{buildOutput();$('output').style.display='block';$('output').scrollIntoView({behavior:'smooth'})};
$('print').onclick=()=>{buildOutput();window.print()};

function md(){
 const d=currentData(),s=d.signals;
 let x=`# Industry Intelligence Pipeline Submission — ${d.company}\n\n**Working tool:** ${d.tool_link}\n\n## 2. Industry Intelligence Brief\n\n### Industry Selection Method\n${d.method}\n\n### Method Limitations\n${d.method_limits}\n\n### Industry Definition and NAICS\n- Primary industry: ${d.primary_report}\n- IBISWorld code: ${d.naics.ibis}\n- Official NAICS: ${d.naics.code} — ${d.naics.title}\n- Alternative: ${d.naics.neighbor} — ${d.naics.neighbor_title}\n- Justification: ${d.naics.why}\n- Source: ${d.naics.source}\n\n`;
 for(const def of signalDefs)x+=`### ${def.label}\n${s[def.id].value}\n\n**Source:** ${s[def.id].source}\n\n`;
 x+=`### Top competitors & market share estimates\n\n| Competitor | Market share | Relevance | Source |\n|---|---:|---|---|\n${d.competitors.map(c=>`| ${c.name} | ${c.share} | ${c.why} | ${c.source} |`).join('\n')}\n\n### Missing Intelligence and Limits\n${d.missing}\n\n## 3. Reflection — 250–500 Words\n${d.reflection||'[PASTE YOUR REFLECTION HERE]'}\n`;
 return x;
}
function download(name,type,text){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},600)}
$('md').onclick=()=>download(`${($('company').value||'company').replace(/\W+/g,'-').toLowerCase()}-industry-brief.md`,'text/markdown',md());
$('json').onclick=()=>download(`${($('company').value||'company').replace(/\W+/g,'-').toLowerCase()}-industry-brief.json`,'application/json',JSON.stringify(currentData(),null,2));
renderFiles();
