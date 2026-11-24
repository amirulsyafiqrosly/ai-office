// Round staff portraits as SVG, drawn from a staff's colour and look
// (look: { scarf: true/false, skin: '#hex', hair: '#hex' }). Same style as the office.

function shade(hex, f) { // f > 0 lighter, f < 0 darker
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)));
  return '#' + c.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

let uid = 0;
export function portrait(colour = '#8D93A5', look = {}, opts = {}) {
  const hex = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d); // values come from office.json
  const col = hex(colour, '#8D93A5');
  const skin = hex(look.skin, '#E8B98A'), hair = hex(look.hair, '#2B2233'), scarf = !!look.scarf;
  const id = `pc${++uid}`;
  const shirt = scarf ? shade(col, -0.3) : col;
  let g = `<defs><clipPath id="${id}"><circle cx="100" cy="100" r="100"/></clipPath></defs>`;
  g += `<g clip-path="url(#${id})"><rect width="200" height="200" fill="${shade(col, 0.72)}"/>`;
  g += `<circle cx="160" cy="40" r="30" fill="#fff" opacity=".35"/><circle cx="35" cy="150" r="22" fill="#fff" opacity=".25"/>`;
  g += `<path d="M22 205 C24 160 58 140 100 140 C142 140 176 160 178 205 Z" fill="${shirt}"/>`;
  if (scarf) {
    g += `<path d="M100 34 C145 34 162 70 160 106 C158 136 176 160 182 205 L18 205 C24 160 42 136 40 106 C38 70 55 34 100 34 Z" fill="${col}"/>`;
    g += `<path d="M100 150 C125 150 150 165 160 205 L40 205 C50 165 75 150 100 150 Z" fill="${shade(col, 0.12)}"/>`;
    g += `<ellipse cx="100" cy="98" rx="40" ry="45" fill="${shade(col, -0.14)}"/>`;
    g += `<ellipse cx="100" cy="102" rx="34" ry="38" fill="${skin}"/>`;
  } else {
    g += `<rect x="88" y="118" width="24" height="28" fill="${shade(skin, -0.08)}"/>`;
    g += `<path d="M84 142 L100 160 L116 142 Z" fill="#fff"/>`;
    g += `<circle cx="62" cy="100" r="9" fill="${skin}"/><circle cx="138" cy="100" r="9" fill="${skin}"/>`;
    g += `<ellipse cx="100" cy="96" rx="38" ry="44" fill="${skin}"/>`;
    g += `<path d="M60 92 C56 54 80 44 102 44 C128 44 146 58 140 94 C134 74 118 66 100 68 C84 68 68 76 60 92 Z" fill="${hair}"/>`;
  }
  const ey = scarf ? 100 : 98;
  if (opts.sleeping) {
    g += `<path d="M80 ${ey} q6 6 12 0 M108 ${ey} q6 6 12 0" stroke="#2B2233" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  } else {
    g += `<ellipse cx="86" cy="${ey}" rx="5" ry="6" fill="#2B2233"/><ellipse cx="114" cy="${ey}" rx="5" ry="6" fill="#2B2233"/>`;
    g += `<circle cx="88" cy="${ey - 2}" r="1.8" fill="#fff"/><circle cx="116" cy="${ey - 2}" r="1.8" fill="#fff"/>`;
  }
  g += `<path d="M78 ${ey - 13} q8 -5 16 -1 M106 ${ey - 14} q8 -4 16 1" stroke="${scarf ? shade(skin, -0.45) : hair}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  g += `<path d="M89 ${ey + 20} Q100 ${ey + 30} 111 ${ey + 20}" stroke="#B23A48" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
  g += `<circle cx="76" cy="${ey + 16}" r="7" fill="#FF8FA3" opacity=".45"/><circle cx="124" cy="${ey + 16}" r="7" fill="#FF8FA3" opacity=".45"/>`;
  g += `</g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${g}</svg>`;
}
