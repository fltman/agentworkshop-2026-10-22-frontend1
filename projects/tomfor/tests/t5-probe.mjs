const B='https://frontend1.torget.bjarby.com';
const R=6371;
function proj(lat0,lon0,p){return [(p[0]-lon0)*Math.PI/180*R*Math.cos(lat0*Math.PI/180),(p[1]-lat0)*Math.PI/180*R];}
function ringArea(r,lat0,lon0){let a=0;const q=r.map(p=>proj(lat0,lon0,p));for(let i=0;i<q.length-1;i++)a+=q[i][0]*q[i+1][1]-q[i+1][0]*q[i][1];return Math.abs(a)/2;}
function polys(g){return g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];}
function area(g,lat,lon){let s=0;for(const p of polys(g)){s+=ringArea(p[0],lat,lon);for(const h of p.slice(1))s-=ringArea(h,lat,lon);}return s;}
function reach(g,lat,lon){let m=0;for(const p of polys(g))for(const c of p[0]){const [x,y]=proj(lat,lon,c);m=Math.max(m,Math.hypot(x,y));}return m;}
const pts=[['centre',59.3326,18.0649],['Sodermalm',59.3142,18.0736]];
const out={};
for(const [n,lat,lon] of pts){
  console.log('##',n);
  for(const m of [30,35,45,60]){const t=Date.now();const r=await fetch(`${B}/t/mareri/walk?lat=${lat}&lon=${lon}&minutes=${m}`);const tx=await r.text();let info=tx.slice(0,120);try{const j=JSON.parse(tx);const f=j.features?.[0]||j;if(f.geometry)info=`area ${area(f.geometry,lat,lon).toFixed(2)} km2 reach ${reach(f.geometry,lat,lon).toFixed(2)} km`;}catch{}console.log(`GET /walk minutes=${m} -> ${r.status} ${info} (${Date.now()-t}ms)`);}
  for(const [label,url] of [['gateway','/t/filbac/api/isochrone'],['mareri','/t/mareri/isochrone']]){
    const t=Date.now();
    const r=await fetch(B+url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({origin:{lat,lon},modes:[],maxTravelMinutes:60,bandMinutes:5,startTime:'2026-10-22T08:00:00'})});
    const j=await r.json().catch(()=>({}));
    console.log(`POST ${label} -> ${r.status} ${Date.now()-t}ms meta`,JSON.stringify({source:j.meta?.source,walkOnly:j.meta?.walkOnly,walkingModel:j.meta?.walkingModel,streetMaxMinutes:j.meta?.streetMaxMinutes,algorithm:j.meta?.algorithm,error:j.error}));
    if(!j.features){continue;}
    const rows=j.features.map(f=>({to:f.properties.toMinutes??f.properties.to_min,src:f.properties.source,est:f.properties.estimated,km2:area(f.geometry,lat,lon),km:reach(f.geometry,lat,lon)})).sort((a,b)=>a.to-b.to);
    let nest=true;for(let i=1;i<rows.length;i++)if(rows[i].km2+1e-9<rows[i-1].km2)nest=false;
    for(const x of rows)console.log(' ',x.to,x.src??'',x.km2.toFixed(2),x.km.toFixed(2));
    const g=k=>rows.find(x=>x.to===k);
    if(g(30)&&g(35))console.log(`  RATIO 35/30 area ${(g(35).km2/g(30).km2).toFixed(2)} reach ${(g(35).km/g(30).km).toFixed(2)} | 30/25 area ${(g(30).km2/g(25).km2).toFixed(2)} | area-monotone ${nest} | props ${Object.keys(j.features[0].properties).join(',')}`);
  }
}
