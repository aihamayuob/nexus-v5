/* Decorative pointer-glow — externalised from the HTML monolith on 2026-11-17 (CSP slice). Former inline <script> body, unchanged. */
(function(){
  try{
    if(!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    var GLOW_SELECTOR = '.agent-chip, .gallery-card, .icon-btn, .mode-chip';
    document.addEventListener('pointermove', function(e){
      var el = e.target && e.target.closest ? e.target.closest(GLOW_SELECTOR) : null;
      if(!el) return;
      var r = el.getBoundingClientRect();
      el.style.setProperty('--spot-x', ((e.clientX - r.left) / r.width * 100) + '%');
      el.style.setProperty('--spot-y', ((e.clientY - r.top) / r.height * 100) + '%');
    }, { passive:true });
  }catch(err){ /* decorative only — never let this affect the app */ }
})();
