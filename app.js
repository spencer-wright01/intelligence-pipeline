
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
  const use=rows.filter(r=>r && r.name).slice(0,5);
  if(!use.length){
    $('competitors').innerHTML='<tr><td colspan="4" class="muted">Run the pipeline to populate source-backed competitors.</td></tr>';
    return;
  }
  $('competitors').innerHTML=use.map((r,i)=>`<tr>
    <td><input id="compName${i}" value="${esc(r.name||'')}"></td>
    <td><input id="compShare${i}" value="${esc(r.share||'Not reported')}" placeholder="Not reported"></td>
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
function extractMarketShareRows(d){
  const rows=[];
  for(const p of d.pages){
    const lines=String(p.text||'').split(/\n+/).map(x=>clean(x)).filter(Boolean);
    let active=false;
    for(const line of lines){
      if(/Company Market Share \(%\)/i.test(line)){active=true;continue}
      if(!active)continue;
      if(/^Information\b/i.test(line))break;
      const m=line.match(/^(.+?)\s+(\d+(?:\.\d+)?(?:\s*[–—-]\s*\d+(?:\.\d+)?)?)\s+(10,000\+|5,001-10,000|1,000-5,000|[0-9,]+)\b/);
      if(!m)continue;
      const name=clean(m[1]);
      if(/Company|Market Share|Employees|Locations|Type|Headquarters/i.test(name))continue;
      const nums=(m[2].match(/\d+(?:\.\d+)?/g)||[]).map(Number);
      rows.push({
        name,
        share:m[2].replace(/\s+/g,'')+'%',
        lower:nums[0]||0,
        upper:nums.length>1?nums[1]:(nums[0]||0),
        evidence:pageEvidence({...p,doc:d.name,title:d.title,section:'Companies / Market Share'},line)
      });
    }
  }
  return [...new Map(rows.map(x=>[x.name.toLowerCase(),x])).values()];
}
function reportCompanyList(d){
  const out=[];
  for(const p of d.pages.slice(0,4)){
    const lines=String(p.text||'').split(/\n+/).map(x=>clean(x)).filter(Boolean);
    let active=false;
    for(const line of lines){
      if(/^Companies$/i.test(line)){active=true;continue}
      if(!active)continue;
      if(/^Information\b|^Related Industries\b|^Related Terms\b|^Additional Resources\b/i.test(line))break;
      const name=line.replace(/^•\s*/,'').trim();
      if(name && name.length<60 && !/Industry|Software Publishers|Developing|Selling/i.test(name))out.push(name);
    }
  }
  return [...new Set(out)];
}
function findPageEvidence(d,re,section){
  for(const p of d.pages){
    const f=flat(p.text),m=f.match(re);
    if(m)return pageEvidence({...p,doc:d.name,title:d.title,section:section||p.section},around(f,m.index,900));
  }
  return null;
}
function bestSentenceFrom(text,terms){
  const sentences=flat(text).split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  let best='',score=-1;
  for(const s of sentences){
    const l=s.toLowerCase();let q=0;
    for(const t of terms)if(l.includes(t.toLowerCase()))q+=3;
    if(/\d/.test(s))q++;
    if(q>score){score=q;best=s}
  }
  return best;
}

function companyMetrics(d,company){
  const shares=extractMarketShareRows(d);
  const share=shares.find(x=>x.name.toLowerCase()===company.toLowerCase())||null;
  const listed=reportCompanyList(d).some(x=>x.toLowerCase()===company.toLowerCase());
  let mentions=0,detail=false;
  for(const p of d.pages){
    const f=flat(p.text);
    mentions+=(f.match(new RegExp("\\b"+rxesc(company)+"\\b","gi"))||[]).length;
    if(/Company Total Revenue|Industry Specific Revenue|Industry Market Share/i.test(f) && new RegExp("\\b"+rxesc(company)+"\\b","i").test(f))detail=true;
  }
  const score=(share?100+Math.min(share.upper*2,60):0)+(detail?35:0)+(listed?20:0)+Math.min(mentions,20);
  return {mentions:mentions,listed:listed,major:!!share,share:share?share.upper:null,shareObj:share,detail:detail,score:score};
}
function selectPrimary(company){
  const ranked=docs.filter(d=>d.status==='ready').map(d=>({d:d,...companyMetrics(d,company)})).sort((a,b)=>b.score-a.score);
  const top=ranked[0], alt=ranked[1];
  const ambiguousPeripheral=!!(top&&alt&&top.shareObj&&alt.shareObj&&top.shareObj.upper<=5&&alt.shareObj.upper<=5&&Math.abs(top.shareObj.upper-alt.shareObj.upper)<0.25&&!top.detail&&!alt.detail);

  if(!top || top.score<35 || ambiguousPeripheral){
    primary=null;
    $('reportSelection').innerHTML=ranked.map(function(r,i){
      const why=(r.shareObj?'Reported company share: '+r.shareObj.share+' · ':'')+(r.detail?'Dedicated company metrics found · ':'')+(r.listed?'Listed in report · ':'')+r.mentions+' company mentions.';
      return '<div class="report-card"><div class="row"><span class="pill">'+(i===0?'INSUFFICIENT FIT':'ALTERNATIVE')+'</span><strong>'+esc(r.d.title)+'</strong><span class="muted">'+esc(r.d.ibisCode||'')+'</span><span class="score">'+r.score.toFixed(0)+'</span></div><div class="reason">'+why+'</div></div>';
    }).join('');
    $('method').value=ambiguousPeripheral
      ? 'No uploaded industry report clearly represents '+company+'\'s primary industry. The company appears only as a peripheral participant in multiple reports at similar market-share levels, so selecting one would overstate the evidence.'
      : 'No uploaded industry report adequately represents '+company+'\'s primary industry. A report whose definition matches the company\'s main products/services and contains meaningful company-specific evidence is required.';
    return {ranked:ranked,accepted:false};
  }

  primary=top.d;
  primary.metrics=top;
  $('reportSelection').innerHTML=ranked.map(function(r,i){
    const why=(r.shareObj?'Reported company share: '+r.shareObj.share+' · ':'')+(r.detail?'Dedicated company metrics found · ':'')+(r.listed?'Listed in report · ':'')+r.mentions+' company mentions.';
    return '<div class="report-card '+(i===0?'primary':'')+'"><div class="row"><span class="pill '+(i===0?'primary':'')+'">'+(i===0?'PRIMARY':'ALTERNATIVE')+'</span><strong>'+esc(r.d.title)+'</strong><span class="muted">'+esc(r.d.ibisCode||'')+'</span><span class="score">'+r.score.toFixed(0)+'</span></div><div class="reason">'+why+'</div></div>';
  }).join('');

  $('method').value='The pipeline compared '+ranked.length+' uploaded industry reports using source-grounded company relevance: reported market share, dedicated company metrics, explicit inclusion in the report\'s company set, and repeated company-specific evidence. "'+top.d.title+'" was selected as the primary industry for '+company+(top.shareObj?' because the report assigns '+company+' '+top.shareObj.share+' market share':'')+(top.detail?' and includes dedicated company metrics':'')+'. '+(alt?'The next-best report scored '+alt.score.toFixed(0)+' versus '+top.score.toFixed(0)+' and is treated only as supplemental; industry statistics are not blended across reports.':'');
  return {ranked:ranked,accepted:true};
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
  const p=primary.pages.find(function(p){
    const f=flat(p.text);
    return /At a Glance/i.test(f)&&/Major Players/i.test(f)&&/Revenue\s+\$?\s*\d/i.test(f);
  });
  if(!p)return {value:'Not found in provided sources.',source:'Not found in provided sources.',ev:[]};
  const f=flat(p.text);
  const rev=f.match(/Revenue\s+\$?\s*(\d+(?:\.\d+)?)\s*(bn|billion|m|million)/i);
  const rates=[...f.matchAll(/(20\d{2})\s*[-–]\s*(\d{2,4})\s+[^0-9%]{0,18}(\d+(?:\.\d+)?)\s*%/g)];
  const profit=f.match(/Profit\s+\$?\s*(\d+(?:\.\d+)?)\s*(bn|billion|m|million)/i);
  const margin=f.match(/Profit Margin\s+(\d+(?:\.\d+)?)\s*%/i);
  const val=[];
  if(rev)val.push('2026 industry revenue: $'+rev[1]+(rev[2].toLowerCase().startsWith('b')?'bn':'m'));
  if(rates[0]){
    const end0=String(rates[0][2]).length===2?String(rates[0][1]).slice(0,2)+rates[0][2]:rates[0][2];
    val.push('historic '+rates[0][1]+'–'+end0+' CAGR: '+rates[0][3]+'%');
  }
  if(rates[1]){
    const end1=String(rates[1][2]).length===2?String(rates[1][1]).slice(0,2)+rates[1][2]:rates[1][2];
    val.push('forecast '+rates[1][1]+'–'+end1+' CAGR: '+rates[1][3]+'%');
  }
  if(profit)val.push('profit: $'+profit[1]+(profit[2].toLowerCase().startsWith('b')?'bn':'m'));
  if(margin)val.push('profit margin: '+margin[1]+'%');
  const e=pageEvidence({...p,doc:primary.name,title:primary.title,section:'At a Glance'},f);
  return {value:val.join('; ')+'.',source:citation(e),ev:[e]};
}
function parseMajorMarkets(){
  if(!primary)return null;
  const p=primary.pages.find(function(p){return /Major Markets Segmentation/i.test(flat(p.text));});
  if(!p)return null;
  const f=flat(p.text);
  const idx=f.indexOf('Major Markets Segmentation');
  const tail=f.slice(idx,Math.min(f.length,idx+1800));
  const pairs=[];
  for(const m of tail.matchAll(/([A-Z][A-Za-z0-9,&'’ \/-]{2,80})\s*\(\$?[\d,.]+\s*(?:bn|m|million|billion)?\)\s*(\d+(?:\.\d+)?)%/g)){
    const segment=clean(m[1]).replace(/^Industry revenue.*?markets\s*/i,'').trim();
    if(segment&&!/Source: IBISWorld/i.test(segment))pairs.push({segment:segment,share:m[2]});
  }
  if(!pairs.length)return null;
  const e=pageEvidence({...p,doc:primary.name,title:primary.title,section:'Major Markets'},tail);
  return {pairs:pairs.slice(0,8),e:e};
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
  const rows=extractMarketShareRows(primary)
    .filter(function(x){return x.name.toLowerCase()!==company.toLowerCase()&&!/^Other Companies$/i.test(x.name);})
    .sort(function(a,b){return b.upper-a.upper||b.lower-a.lower||a.name.localeCompare(b.name);});
  return rows.slice(0,3).map(function(x){
    return {
      name:x.name,
      share:x.share,
      why:'Top source-backed competitor by reported industry market-share estimate in the selected primary report.',
      source:citation(x.evidence),
      upper:x.upper
    };
  });
}
function runPipeline(){
  const company=$('company').value.trim();
  $('runStatus').style.display='inline-block';
  if(!company){$('runStatus').textContent='Enter a company name.';return}
  const ready=docs.filter(function(d){return d.status==='ready';});
  if(!ready.length){$('runStatus').textContent='Upload at least one PDF and wait for parsing to finish.';return}
  $('runStatus').textContent='Analyzing reports…';

  const selection=selectPrimary(company);
  if(!selection.accepted){
    for(const s of signalDefs){
      autoSignal(s.id,'Not analyzed because no uploaded report adequately represents this company.','Not found in provided sources.',[],s.keys);
    }
    renderCompetitorRows([]);
    $('compConf').className='conf low';
    $('compConf').textContent='no adequate primary report';
    $('missing').value='A directly relevant industry report is required before the pipeline can produce defensible industry statistics for this company.';
    $('runStatus').textContent='Stopped: no uploaded report adequately represents this company’s primary industry.';
    updateAudit();
    return;
  }

  extractNaics();

  const sg=extractSizeGrowth();
  autoSignal('sizeGrowth',sg.value,sg.source,sg.ev,signalDefs[0].keys);

  const regPage=findPageEvidence(primary,/Regulation\s*&\s*Policy/i,'Regulation & Policy');
  let regValue='Not found in provided sources.';
  if(regPage){
    const f=flat(regPage.snippet);
    const rating=f.match(/Regulation\s*&\s*Policy\s+(Low|Moderate|High)\s+(Steady|Increasing|Decreasing)/i);
    const topics=[];
    if(/copyright|intellectual property/i.test(f))topics.push('copyright/IP');
    if(/privacy|CCPA|CPRA|GDPR|data protection/i.test(f))topics.push('data privacy');
    if(/COPPA|parental consent|children/i.test(f))topics.push('child-data privacy');
    if(/antitrust|merger|acquisition/i.test(f))topics.push('antitrust/M&A scrutiny');
    if(/cybersecurity|security audit/i.test(f))topics.push('cybersecurity');
    regValue='IBISWorld rates Regulation & Policy as '+(rating?(rating[1].toUpperCase()+' and '+rating[2].toUpperCase()):'described in the cited section')+'. Key pressure areas in the report include '+(topics.length?topics.join(', '):'the regulatory issues described in the cited section')+'.';
  }
  autoSignal('regulation',regValue,regPage?citation(regPage):'',regPage?[regPage]:[],signalDefs.find(function(s){return s.id==='regulation';}).keys);

  const powerPage=findPageEvidence(primary,/Suppliers:/i,'Buyer & Supplier Power');
  let supplyValue='Not found in provided sources.';
  if(powerPage){
    const f=flat(powerPage.snippet);
    const rating=f.match(/(Low|Moderate|High)\s+(Steady|Increasing|Decreasing)\s+Suppliers:/i);
    const details=[];
    if(/NVIDIA.*92\.0%/i.test(f))details.push('NVIDIA controlled about 92% of the discrete GPU market');
    if(/AWS.*Azure.*GCP|Azure.*GCP/i.test(f))details.push('AWS, Azure and GCP provide cloud alternatives');
    if(/Apple and Google|Apple.*Google/i.test(f))details.push('Apple and Google act as mobile-platform gatekeepers');
    if(/switching costs|limited alternatives|Dell|HP|Cisco/i.test(f))details.push('specialized hardware can create switching costs and limited alternatives');
    supplyValue='Supplier power is '+(rating?(rating[1].toUpperCase()+' and '+rating[2].toUpperCase()):'described in the report')+'. '+(details.length?details.join('; ')+'. ':'')+'Analyst interpretation: fragility is tied to specific concentrated dependencies or switching costs, not to software inputs in general.';
  }
  autoSignal('supply',supplyValue,powerPage?citation(powerPage):'',powerPage?[powerPage]:[],signalDefs.find(function(s){return s.id==='supply';}).keys);

  const mm=parseMajorMarkets();
  const buyerPage=findPageEvidence(primary,/Buyers:/i,'Buyer & Supplier Power');
  let customerValue='Not found in provided sources.',customerSource='';
  if(mm){
    const top3=[...mm.pairs].sort(function(a,b){return Number(b.share)-Number(a.share);}).slice(0,3).reduce(function(sum,x){return sum+Number(x.share);},0);
    let buyer='';
    if(buyerPage){
      const fm=flat(buyerPage.snippet).match(/(Low|Moderate|High)\s+(Steady|Increasing|Decreasing)\s+Buyers:/i);
      if(fm)buyer=' IBISWorld rates buyer power as '+fm[1].toUpperCase()+' and '+fm[2].toUpperCase()+'.';
    }
    customerValue='2026 demand is split across reported customer markets as follows: '+mm.pairs.map(function(x){return x.segment+' '+x.share+'%';}).join('; ')+'. The top three verticals account for '+top3.toFixed(1)+'% of revenue.'+buyer+' Analyst interpretation: vertical revenue concentration can coexist with a fragmented underlying buyer base.';
    customerSource=citation(mm.e);
  }else if(buyerPage){
    customerValue=bestSentenceFrom(buyerPage.snippet,['fragmented','buyers','businesses','customers'])||'Buyer structure is described in the cited section.';
    customerSource=citation(buyerPage);
  }
  autoSignal('customers',customerValue,customerSource,buyerPage?[buyerPage]:[],signalDefs.find(function(s){return s.id==='customers';}).keys);

  const outlookPages=primary.pages.filter(function(p){return /Outlook/i.test(flat(p.text))||/over the next five years/i.test(flat(p.text));});
  const outlookText=outlookPages.map(function(p){return flat(p.text);}).join(' ');
  const trendEv=outlookPages.slice(0,3).map(function(p){return pageEvidence({...p,doc:primary.name,title:primary.title,section:'Outlook'},p.text);});
  let trendValue='Not found in provided sources.';
  if(/AI and generative tools|generative AI|artificial intelligence/i.test(outlookText)){
    trendValue='Analyst interpretation — biggest five-year trend: AI-driven and generative-AI-enabled workflows. The outlook emphasizes continued AI integration, automation, scalable infrastructure and AI-assisted product capabilities.';
  }else if(/cybersecurity|zero-trust/i.test(outlookText)){
    trendValue='Analyst interpretation — biggest five-year trend: rising investment in cybersecurity and zero-trust capabilities as software vendors compete on trust, resilience and compliance.';
  }else if(outlookPages.length){
    trendValue=bestSentenceFrom(outlookText,['will','next five years','outlook','increasingly'])||'See cited outlook section.';
  }
  autoSignal('trend',trendValue,trendEv[0]?citation(trendEv[0]):'',trendEv,signalDefs.find(function(s){return s.id==='trend';}).keys);

  let threatValue='Not found in provided sources.';
  if(/free and open-source alternatives.*(?:rise|intensif)|threat posed by free and open-source alternatives/i.test(outlookText)){
    threatValue='Analyst interpretation — biggest five-year threat: increasing competition from free and open-source alternatives, which the report expects to narrow functional gaps and pressure pricing and differentiation.';
  }else if(/market saturation|saturated/i.test(outlookText)){
    threatValue='Analyst interpretation — biggest five-year threat: market saturation, which the report expects to slow growth and make new-customer acquisition harder.';
  }else if(/cyber attacks|cybersecurity/i.test(outlookText)){
    threatValue='Analyst interpretation — biggest five-year threat: escalating cybersecurity risk and the cost of maintaining trusted, resilient platforms.';
  }else if(outlookPages.length){
    threatValue=bestSentenceFrom(outlookText,['threat','risk','challenge','pressure','slower'])||'See cited outlook section.';
  }
  autoSignal('threat',threatValue,trendEv[0]?citation(trendEv[0]):'',trendEv,signalDefs.find(function(s){return s.id==='threat';}).keys);

  const comps=competitorCandidates(company);
  renderCompetitorRows(comps);
  $('compConf').className='conf '+(comps.length>=3?'high':comps.length?'med':'low');
  $('compConf').textContent=comps.length>=3?'3 source-backed competitors':'insufficient competitor data';
  const compEvidence=extractMarketShareRows(primary).map(function(x){return x.evidence;}).slice(0,4);
  renderEvidence('compEvidence',compEvidence,['market share','company'],function(e){
    const i=[0,1,2].find(function(i){return !$('compSrc'+i)?.value;});
    if(i!==undefined)$('compSrc'+i).value=citation(e);
    updateAudit();
  });

  refreshMissing();
  $('runStatus').textContent='Done. "'+primary.title+'" selected as the primary report. Industry-level statistics were kept inside that report rather than blended across reports.';
  updateAudit();
}
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
 const compRows=d.competitors.length?d.competitors.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.share||'Not reported')}</td><td>${esc(c.why)}</td><td>${esc(c.source)}</td></tr>`).join(''):'<tr><td colspan="4">Not found in provided sources.</td></tr>';
 const signalClass=id=>id==='trend'?'trend':id==='threat'?'threat':'';
 const signalCards=signalDefs.map(s=>`<div class="pdf-signal ${signalClass(s.id)}"><div class="signal-label">${esc(sig[s.id].label)}</div><div class="signal-text">${esc(sig[s.id].value||'Not found in provided sources.')}</div><div class="citation"><span class="source-chip">SOURCE</span>${esc(sig[s.id].source||'Not found in provided sources.')}</div></div>`).join('');
 const exactShares=d.competitors.filter(c=>c.share&&!/not reported/i.test(c.share)).length;
 $('output').innerHTML=`
 <div class="pdf-cover">
   <div class="pdf-kicker">STRAT 560 · Industry Intelligence Pipeline</div>
   <div class="pdf-title-row">
     <div><h1>${esc(d.company||'Company')}</h1><div class="pdf-subtitle">Industry Intelligence Brief & Signal Traceability</div></div>
     <div class="pdf-code"><div class="label">Selected NAICS</div><div class="value">${esc(d.naics.code||'—')}</div><div class="label">${esc(d.naics.title||'')}</div></div>
   </div>
   <div class="pdf-meta">
     <span><strong>Primary industry:</strong> ${esc(d.primary_report||'Not selected')}</span>
     <span><strong>Analyst:</strong> ${esc(d.analyst||'—')}</span>
     <span><strong>Generated:</strong> ${esc(d.generated)}</span>
   </div>
 </div>

 <div class="tool-banner"><span class="tool-tag">PUBLIC TOOL</span><span class="tool-url">${esc(d.tool_link)}</span></div>

 <div class="pdf-section">
   <div class="pdf-section-title"><span class="num">01</span>Industry Selection & Classification</div>
   <div class="pdf-grid">
     <div class="pdf-card"><h3>Industry Selection Method</h3><p>${esc(d.method||'Not yet generated.')}</p></div>
     <div class="pdf-card soft"><h3>Method Limitation</h3><p>${esc(d.method_limits)}</p></div>
     <div class="pdf-card wide"><h3>NAICS Classification</h3>
       <p><strong>IBISWorld code:</strong> ${esc(d.naics.ibis||'Not found')} &nbsp; | &nbsp; <strong>Official NAICS:</strong> ${esc(d.naics.code||'Not found')} — ${esc(d.naics.title||'')}</p>
       <p><strong>Why this code:</strong> ${esc(d.naics.why||'Not completed')}</p>
       <p class="citation"><span class="source-chip">SOURCE</span>${esc(d.naics.source||'Not found in provided sources.')}${d.naics.neighbor?` &nbsp; | &nbsp; <strong>Alternative:</strong> ${esc(d.naics.neighbor)} — ${esc(d.naics.neighbor_title)}`:''}</p>
     </div>
   </div>
 </div>

 <div class="pdf-section">
   <div class="pdf-section-title"><span class="num">02</span>Industry Intelligence Signals</div>
   <div class="pdf-summary">
     <div class="metric"><div class="m-label">Primary Report</div><div class="m-value">${esc(d.primary_code||d.naics.ibis||'—')}</div></div>
     <div class="metric"><div class="m-label">Signals Sourced</div><div class="m-value">${Object.values(sig).filter(x=>x.source&&!/not found/i.test(x.source)).length} / ${signalDefs.length}</div></div>
     <div class="metric"><div class="m-label">Competitor Shares</div><div class="m-value">${exactShares} reported</div></div>
   </div>
   <div class="pdf-grid">${signalCards}</div>
 </div>

 <div class="pdf-section">
   <div class="pdf-section-title"><span class="num">03</span>Competitive Landscape</div>
   <table><thead><tr><th>Competitor</th><th>Market Share</th><th>Competitive Relevance</th><th>Source</th></tr></thead><tbody>${compRows}</tbody></table>
 </div>

 <div class="pdf-section">
   <div class="pdf-section-title"><span class="num">04</span>Missing Intelligence & Limits</div>
   <div class="pdf-card warnbox"><p>${esc(d.missing||'Not completed')}</p></div>
 </div>

 <div class="pdf-section">
   <div class="pdf-section-title"><span class="num">05</span>Source Traceability Matrix</div>
   <table><thead><tr><th>Required Signal</th><th>Main Finding</th><th>Source</th></tr></thead><tbody>
   <tr><td><strong>Industry selection</strong></td><td>${esc(d.primary_report)}</td><td>${esc(d.method)}</td></tr>
   <tr><td><strong>NAICS</strong></td><td>${esc(`${d.naics.code} — ${d.naics.title}`)}</td><td>${esc(d.naics.source)}</td></tr>
   ${signalDefs.map(s=>`<tr><td><strong>${esc(sig[s.id].label)}</strong></td><td>${esc(sig[s.id].value)}</td><td>${esc(sig[s.id].source)}</td></tr>`).join('')}
   <tr><td><strong>Competitors / market shares</strong></td><td>${esc(d.competitors.map(c=>`${c.name}: ${c.share||'Not reported'}`).join('; '))}</td><td>${esc(d.competitors.map(c=>c.source).filter(Boolean).join('; '))}</td></tr>
   </tbody></table>
 </div>

 <div class="pdf-section">
   <div class="pdf-section-title"><span class="num">06</span>Strategic Reflection</div>
   <div class="reflection-box">${esc(d.reflection||'[PASTE YOUR REFLECTION HERE BEFORE FINAL EXPORT]')}</div>
 </div>
 <div class="pdf-footer-note">Industry Intelligence Pipeline · Source-grounded output generated from analyst-supplied reports</div>
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
