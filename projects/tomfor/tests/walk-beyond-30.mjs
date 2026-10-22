const B='https://frontend1.torget.bjarby.com';
const R=6371;
function proj(lat0,lon0,p){const x=(p[0]-lon0)*Math.PI/180*R*Math.cos(lat0*Math.PI/180);const y=(p[1]-lat0)*Math.PI/180*R;return [x,y];}
function ringArea(r,lat0,lon0){let a=0;const q=r.map(p=>proj(lat0,lon0,p));for(let i=0;i<q.length-1;i++)a+=q[i][0]*q[i+1][1]-q[i+1][0]*q[i][1];return Math.abs(a)/2;}
function area(g,lat,lon){const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;let s=0;for(const p of polys){s+=ringArea(p[0],lat,lon);for(const h of p.slice(1))s-=ringArea(h,lat,lon);}return s;}
function reach(g,lat,lon){const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;let m=0;for(const p of polys)for(const c of p[0]){const [x,y]=proj(lat,lon,c);m=Math.max(m,Math.hypot(x,y));}return m;}
const pts=[['centre',59.3326,18.0649],['Sodermalm/Medborgarplatsen',59.3142,18.0736]];
for(const [n,lat,lon] of pts){
 const r=await fetch(B+'/t/filbac/api/isochrone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({origin:{lat,lon},modes:[],maxTravelMinutes:60,bandMinutes:5})});
 const j=await r.json();
 console.log('##',n,lat,lon,'status',r.status,'meta',JSON.stringify({source:j.meta?.source,algorithm:j.meta?.algorithm,walkOnly:j.meta?.walkOnly}));
 const rows=j.features.map(f=>({to:f.properties.toMinutes??f.properties.to_min,src:f.properties.source,km2:area(f.geometry,lat,lon),km:reach(f.geometry,lat,lon),keys:Object.keys(f.properties).join(',')})).sort((a,b)=>a.to-b.to);
 for(const x of rows)console.log(x.to,x.src,x.km2.toFixed(2),x.km.toFixed(2));
 console.log('props',rows[0].keys);
 const a=rows.find(x=>x.to===30),b=rows.find(x=>x.to===35),c=rows.find(x=>x.to===25);
 console.log('RATIO 35/30 area',(b.km2/a.km2).toFixed(2),'reach',(b.km/a.km).toFixed(2),' | 30/25 area',(a.km2/c.km2).toFixed(2),'reach',(a.km/c.km).toFixed(2));
}
