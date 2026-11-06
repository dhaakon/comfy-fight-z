#!/usr/bin/env node
// Frame data of every normal, system move and special, measured by simulation (gameplay-audit.md, phase 0).
// Usage: node build/tools/frame-data.cjs [--markdown] [--json] [--engine <engine.js>]
// Columns follow build/tools/lib/gameplay-metrics.cjs: frames at 60 fps, startup = first active frame, advantage =
// the frame the defender can act minus the frame the attacker can act with contact on the first active frame.
const path = require('node:path');
const M = require('./lib/gameplay-metrics.cjs');

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const enginePath = path.resolve(option('--engine') || path.join(__dirname, '../public/engine.js'));
const E = require(enginePath);
const rows = M.measureAll(E), life = M.maxLife(E);

if (args.includes('--json')) console.log(JSON.stringify({ engine: path.relative(process.cwd(), enginePath) || enginePath, maxLife: life, bodyHeight: M.bodyHeight(E), distance: M.POINT_BLANK, rows }, null, 2));
else printTable();

function printTable() {
  const markdown = args.includes('--markdown');
  const GROUPS = [['normal', 'Ground normals'], ['air', 'Air normals (no advantage: it depends on the height of the hit)'], ['system', 'System moves'], ['special', 'Specials'], ['super', 'Supers'], ['sequence', 'Sequences']];
  const dash = value => value === null || value === undefined ? '-' : String(value);
  const points = value => Number.isInteger(value) ? String(value) : String(M.round(value, 1));
  const damage = row => !row.hits ? '-' : `${points(row.damagePoints)} (${M.percent(row.damage)}${row.hits > 1 ? `, ${row.hits} hits` : ''})`;
  const slide = (distance, frames) => distance === null || distance === undefined ? '-' : `${points(M.round(distance, 1))} (${frames}f)`;
  const pair = (a, b) => a === null && b === null ? '-' : `${dash(a)} / ${dash(b)}`;
  const moveName = row => `${row.move}${row.variant && row.variant !== 'standing' ? ' ' + row.variant : ''}${row.airborne && row.variant !== 'air' ? ' (air)' : ''}${row.boss ? ' (boss)' : ''}${row.kind === 'special' && row.style && row.style !== 'balanced' ? ` [${row.style}]` : ''}`;
  const stun = (value, row, blocked) => blocked && row.unblockable ? 'unblockable' : dash(value);
  const HEAD = ['Input', 'Move', 'Startup', 'Active', 'Recovery', 'Total', 'Hitstun', 'Blockstun', 'On hit', 'On block', 'Damage', 'Chip', 'Reach', 'Slide hit / block', 'Meter hit / block', 'Invuln'];
  const cells = row => [markdown ? `\`${row.input}\` ${row.notation}` : row.input, moveName(row), dash(row.startup), dash(row.active), dash(row.recovery), dash(row.total),
    stun(row.hitstun, row), stun(row.blockstun, row, true), row.airborne ? '-' : M.signed(row.advantageHit), row.airborne ? '-' : M.signed(row.advantageBlock), damage(row),
    row.chipDamagePoints ? points(row.chipDamagePoints) : '-', dash(row.reach), row.slide === null && row.slideBlock === null ? '-' : `${slide(row.slide, row.slideFrames)} / ${slide(row.slideBlock, row.slideBlockFrames)}`,
    pair(row.meterGain, row.meterGainBlock), row.invulnerable ? `${row.invulnerable}f` : '-'];
  const sequence = row => `${row.id} (${row.input}${row.style ? `, ${row.style}` : ''}): ${row.hits} hits, ${row.hitDamages.map(points).join(' + ')} = ${points(row.damagePoints)} (${M.percent(row.damage)}), ${row.connected ? 'every press connects' : 'a press does not connect'}`;

  const out = [];
  const title = `Comfy Fighter Z frame data, measured by simulation at ${M.POINT_BLANK} units (${life} life points; frames at 60 fps).`;
  const legend = 'Startup is the first active frame; advantage is the frame the defender can act minus the frame the attacker can act, with contact on the first active frame. KD = knockdown. Slide is the distance the defender travels. Meter is the attacker\'s gauge gain (one stock = ' + (E.BAR || 100) + '). Invuln is the number of invulnerable frames; moves that never strike leave the strike columns empty.';
  if (markdown) { out.push(`# Frame data`, '', title, '', legend, ''); }
  else out.push(title, legend, '');
  for (const [kind, heading] of GROUPS) {
    const group = rows.filter(row => row.kind === kind);
    if (!group.length) continue;
    if (kind === 'sequence') {
      out.push(markdown ? `## ${heading}` : `${heading}:`, ...(markdown ? [''] : []), ...group.map(row => (markdown ? '- ' : '  ') + sequence(row)), '');
      continue;
    }
    const table = group.map(cells);
    if (markdown) {
      out.push(`## ${heading}`, '', `| ${HEAD.join(' | ')} |`, `|${HEAD.map((_, i) => i < 2 ? '---' : '---:').join('|')}|`, ...table.map(r => `| ${r.join(' | ')} |`), '');
    } else {
      const widths = HEAD.map((h, i) => Math.max(h.length, ...table.map(r => r[i].length)));
      const line = r => r.map((c, i) => i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i])).join('  ').trimEnd();
      out.push(`${heading}:`, line(HEAD), ...table.map(line), '');
    }
  }
  const notes = rows.filter(row => row.notes?.length).map(row => `${row.id}: ${row.notes.join('; ')}`);
  if (notes.length) out.push(markdown ? '## Notes' : 'Notes:', ...(markdown ? [''] : []), ...notes.map(note => (markdown ? '- ' : '  ') + note));
  console.log(out.join('\n').trimEnd());
}
