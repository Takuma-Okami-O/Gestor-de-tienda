/* Plantilla del catálogo web independiente (se genera desde la app).
   OJO: dentro de esta plantilla no se usan comillas invertidas ni "dollar-llave". */
window.CATALOG_TPL = String.raw`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="__COLOR__"><title>__TITLE__</title>
<style>
:root{--a:__COLOR__;--ink:#0f172a;--m:#64748b;--l:#e8eaf0}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{font-family:Inter,"Segoe UI",system-ui,-apple-system,Roboto,Arial,sans-serif;background:__BG__;color:#1e293b;line-height:1.45}
button,input{font:inherit;color:inherit}button{border:0;cursor:pointer;background:none}
.hero{background:linear-gradient(135deg,var(--a),#0f172a);color:#fff;padding:34px 18px 54px;text-align:center}
.hero .lg{width:78px;height:78px;border-radius:22px;background:#fff;color:var(--a);margin:0 auto 12px;display:grid;place-items:center;font-weight:800;font-size:28px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.3)}
.hero .lg img{width:100%;height:100%;object-fit:cover}
.hero .wide{display:block;width:min(300px,78%);height:auto;margin:0 auto 6px}.hero h1{font-size:27px;letter-spacing:-.4px}.hero p{opacity:.85;margin-top:4px}
.hero .ad{font-size:13px;opacity:.7;margin-top:6px}
.wrap{max-width:1100px;margin:-28px auto 0;padding:0 14px 110px}
.bar{background:#fff;border-radius:18px;padding:12px;box-shadow:0 8px 28px rgba(15,23,42,.1);position:sticky;top:8px;z-index:20}
.bar input{width:100%;padding:12px 14px;border:1.5px solid var(--l);border-radius:12px;outline:none;font-size:15px}
.bar input:focus{border-color:var(--a)}
.chips{display:flex;gap:8px;overflow-x:auto;padding:10px 0 2px;scrollbar-width:none}.chips::-webkit-scrollbar{display:none}
.chip{padding:7px 16px;border-radius:99px;background:#fff;border:1.5px solid var(--l);font-weight:700;font-size:13px;white-space:nowrap;color:#475569}
.chip.on{background:var(--a);border-color:var(--a);color:__INK__}
.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:16px}
@media(min-width:700px){.grid{grid-template-columns:repeat(3,1fr);gap:18px}}@media(min-width:980px){.grid{grid-template-columns:repeat(4,1fr)}}
.card{background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 2px 14px rgba(15,23,42,.07);cursor:pointer;display:flex;flex-direction:column;transition:.18s}
.card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(15,23,42,.14)}
.im{aspect-ratio:1/1;background:#eef0f5;position:relative;overflow:hidden}.im img{width:100%;height:100%;object-fit:cover;display:block}
.ph{width:100%;height:100%;display:grid;place-items:center;color:#fff;font-weight:800;font-size:38px}
.tg{position:absolute;left:8px;top:8px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;background:#fee2e2;color:#dc2626}.tg.w{background:#fef3c7;color:#b45309}
.bd{padding:11px 12px 13px;display:flex;flex-direction:column;flex:1}
.nm{font-weight:700;font-size:14px;color:var(--ink);line-height:1.3}.ct{font-size:12px;color:var(--m);margin-top:2px}
.pr{font-weight:800;font-size:17px;color:var(--a);margin-top:auto;padding-top:8px}
.card.out{opacity:.6}
.empty{grid-column:1/-1;text-align:center;color:var(--m);padding:50px 10px}
.cb{position:fixed;left:14px;right:14px;bottom:14px;max-width:560px;margin:0 auto;background:var(--ink);color:#fff;border-radius:18px;padding:15px 20px;display:none;justify-content:space-between;align-items:center;font-weight:800;box-shadow:0 14px 34px rgba(15,23,42,.4);z-index:50}
.cb .n{background:var(--a);color:__INK__;border-radius:99px;padding:2px 11px;margin-right:10px}
.ov{position:fixed;inset:0;background:rgba(15,23,42,.6);display:none;align-items:flex-end;justify-content:center;z-index:100}.ov.on{display:flex}
.sh{background:#fff;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:24px 24px 0 0;padding:18px 18px 24px}
@media(min-width:700px){.ov{align-items:center}.sh{border-radius:24px}}
.x{float:right;width:36px;height:36px;border-radius:50%;background:#f1f5f9;font-size:18px}
.big{width:100%;aspect-ratio:1/1;border-radius:18px;overflow:hidden;background:#eef0f5;margin:6px 0 10px}.big img{width:100%;height:100%;object-fit:cover}
.th{display:flex;gap:8px;margin-bottom:12px}.th img{width:58px;height:58px;border-radius:10px;object-fit:cover;border:2px solid transparent;cursor:pointer}.th img.on{border-color:var(--a)}
.sh h2{font-size:21px;color:var(--ink);letter-spacing:-.2px}.sh .pp{font-size:24px;font-weight:800;color:var(--a);margin:6px 0}
.sh .ds{color:#475569;margin:8px 0 14px;white-space:pre-line}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:14px;border-radius:14px;background:var(--a);color:__INK__;font-weight:800;font-size:16px}
.btn[disabled]{opacity:.4}.btn.g{background:#25D366;color:#fff}.btn.o{background:#f1f5f9;color:var(--ink)}
.qr{display:flex;align-items:center;gap:6px;background:#f1f5f9;border-radius:12px;padding:4px}.qr button{width:36px;height:36px;font-weight:800;font-size:18px;border-radius:10px}.qr b{min-width:24px;text-align:center}
.ln{display:flex;gap:12px;align-items:center;padding:11px 0;border-bottom:1px dashed var(--l)}.ln img,.ln .ph{width:52px;height:52px;border-radius:11px;object-fit:cover;font-size:16px;flex:none}
.ln .t{flex:1;min-width:0;font-weight:700;font-size:14px}.ln .t small{display:block;color:var(--m);font-weight:500}
.tt{display:flex;justify-content:space-between;font-size:20px;font-weight:800;margin:14px 0;color:var(--ink)}
.in{width:100%;padding:12px 14px;border:1.5px solid var(--l);border-radius:12px;margin-bottom:12px;outline:none}.in:focus{border-color:var(--a)}
.ft{text-align:center;color:var(--m);font-size:12.5px;margin-top:34px}
</style></head><body>
<div class="hero"><div class="lg" id="lg"></div><h1 id="hn"></h1><p id="hs"></p><div class="ad" id="ha"></div></div>
<div class="wrap"><div class="bar"><input id="q" placeholder="Buscar productos…" autocomplete="off"><div class="chips" id="ch"></div></div>
<div class="grid" id="gr"></div><div class="ft" id="ft"></div></div>
<button class="cb" id="cb" onclick="openCart()"><span><span class="n" id="cn">0</span>Mi pedido</span><span id="ct"></span></button>
<div class="ov" id="ov" onclick="if(event.target===this)closeO()"><div class="sh" id="sh"></div></div>
<script>
var D=__DATA__;var cart={},cat='Todas',q='';
function $(i){return document.getElementById(i)}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function money(n){return D.moneda+Number(n).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}
function ini(s){return String(s||'?').trim().split(/\s+/).slice(0,2).map(function(w){return w[0]}).join('').toUpperCase()}
function hue(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360;return h}
function ph(n){var h=((D.hue||250)+(hue(n)%56)-28+360)%360;return '<div class="ph" style="background:linear-gradient(135deg,hsl('+h+' 42% 56%),hsl('+((h+14)%360)+' 46% 40%))">'+esc(ini(n))+'</div>'}
function pic(p){return p.imagenes&&p.imagenes[0]?'<img src="'+p.imagenes[0]+'" alt="">':ph(p.nombre)}
function byId(id){for(var i=0;i<D.productos.length;i++)if(D.productos[i].id===id)return D.productos[i]}
function init(){
  if(D.logoWide){$('lg').outerHTML='<img class="wide" src="'+D.logoWide+'" alt="">';$('hn').style.display='none'}else{$('lg').innerHTML=D.logo?'<img src="'+D.logo+'">':esc(ini(D.nombre));$('hn').textContent=D.nombre}
  $('hs').textContent=D.slogan||'Catálogo de productos';
  $('ha').textContent=D.direccion||'';$('ft').textContent=D.pie||'';
  $('q').oninput=function(){q=this.value.toLowerCase();draw()};
  var used={};D.productos.forEach(function(p){used[p.categoria]=1});
  var cats=['Todas'].concat(D.categorias.filter(function(c){return used[c]}));
  $('ch').innerHTML=cats.map(function(c){return '<button class="chip'+(c===cat?' on':'')+'" data-c="'+esc(c)+'">'+esc(c)+'</button>'}).join('');
  var b=$('ch').children;for(var i=0;i<b.length;i++)b[i].onclick=function(){cat=this.getAttribute('data-c');for(var j=0;j<b.length;j++)b[j].className='chip'+(b[j]===this?' on':'');draw()};
  draw();
}
function draw(){
  var l=D.productos.filter(function(p){return(cat==='Todas'||p.categoria===cat)&&(!q||(p.nombre+' '+p.categoria+' '+(p.variante||'')).toLowerCase().indexOf(q)>-1)});
  var h='';
  l.forEach(function(p){
    var tag=p.stock<=0?'<span class="tg">Agotado</span>':(p.stock<=(p.minimo||0)?'<span class="tg w">Últimas unidades</span>':'');
    h+='<div class="card'+(p.stock<=0?' out':'')+'" onclick="openP(\''+p.id+'\')"><div class="im">'+pic(p)+tag+'</div><div class="bd"><div class="nm">'+esc(p.nombre)+'</div><div class="ct">'+esc(p.variante||p.categoria)+'</div><div class="pr">'+money(p.precio)+'</div></div></div>';
  });
  $('gr').innerHTML=h||'<div class="empty"><b>No encontramos productos</b><br>Prueba con otra búsqueda.</div>';
}
function openO(h){$('sh').innerHTML=h;$('ov').className='ov on'}
function closeO(){$('ov').className='ov'}
function openP(id){
  var p=byId(id),imgs=p.imagenes||[],th='';
  if(imgs.length>1){th='<div class="th">'+imgs.map(function(s,i){return '<img src="'+s+'" class="'+(i===0?'on':'')+'" onclick="sw(this)">'}).join('')+'</div>'}
  openO('<button class="x" onclick="closeO()">✕</button><div class="big" id="bg">'+pic(p)+'</div>'+th+'<h2>'+esc(p.nombre)+'</h2><div class="ct">'+esc(p.categoria)+(p.variante?' · '+esc(p.variante):'')+'</div><div class="pp">'+money(p.precio)+'</div>'+(p.desc?'<div class="ds">'+esc(p.desc)+'</div>':'')+
   (p.stock>0?'<button class="btn" onclick="add(\''+p.id+'\',1);closeO()">Agregar al pedido</button>':'<button class="btn" disabled>Agotado</button>'));
}
function sw(el){$('bg').innerHTML='<img src="'+el.src+'">';var t=el.parentNode.children;for(var i=0;i<t.length;i++)t[i].className=t[i]===el?'on':''}
function add(id,d){var p=byId(id),n=(cart[id]||0)+d;if(n>p.stock)n=p.stock;if(n<=0)delete cart[id];else cart[id]=n;upd()}
function tot(){var t=0,n=0;for(var k in cart){var p=byId(k);t+=p.precio*cart[k];n+=cart[k]}return{t:t,n:n}}
function upd(){var s=tot();$('cb').style.display=s.n?'flex':'none';$('cn').textContent=s.n;$('ct').textContent=money(s.t);if($('ov').className.indexOf('on')>-1&&$('cl'))openCart()}
function openCart(){
  var h='<button class="x" onclick="closeO()">✕</button><h2 style="margin-bottom:6px">Mi pedido</h2><div id="cl">';
  for(var k in cart){var p=byId(k);h+='<div class="ln">'+(p.imagenes&&p.imagenes[0]?'<img src="'+p.imagenes[0]+'">':ph(p.nombre))+'<div class="t">'+esc(p.nombre)+'<small>'+money(p.precio)+(p.variante?' · '+esc(p.variante):'')+'</small></div><div class="qr"><button onclick="add(\''+k+'\',-1)">−</button><b>'+cart[k]+'</b><button onclick="add(\''+k+'\',1)">+</button></div></div>'}
  var s=tot();
  if(!s.n){closeO();return}
  h+='</div><div class="tt"><span>Total</span><span>'+money(s.t)+'</span></div><input class="in" id="nm" placeholder="Tu nombre"><input class="in" id="nt" placeholder="Notas (talla, color, entrega…)">';
  h+=D.whatsapp?'<button class="btn g" onclick="send()">Enviar pedido por WhatsApp</button>':'<button class="btn" onclick="copyO()">Copiar pedido</button>';
  openO(h);
}
function msg(){
  var L=['Hola '+D.nombre+', quiero hacer este pedido:',''];
  for(var k in cart){var p=byId(k);L.push('• '+cart[k]+' x '+p.nombre+(p.variante?' ('+p.variante+')':'')+' — '+money(p.precio*cart[k]))}
  L.push('','*Total: '+money(tot().t)+'*');
  var n=$('nm').value.trim(),t=$('nt').value.trim();
  if(n)L.push('Nombre: '+n);if(t)L.push('Notas: '+t);
  return L.join('\n');
}
function send(){window.open('https://wa.me/'+D.whatsapp+'?text='+encodeURIComponent(msg()),'_blank')}
function copyO(){var t=msg();if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){alert('Pedido copiado. Pégalo en tu mensaje.')})}else{prompt('Copia tu pedido:',t)}}
init();
</script></body></html>`;
