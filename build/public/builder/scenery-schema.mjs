// Living stage scenery vocabulary, shared by the builder and build/tools/stage-scenery.cjs. The node pack
// (comfyui/custom_nodes/comfy_fighter_assets/__init__.py) and the renderer (render/scenery.js) use the same names.
export const SCENERY_WEATHER = ['none', 'rain', 'storm', 'snow', 'leaves', 'petals', 'dust', 'embers', 'ash'];
export const LAYER_MOTIONS = ['still', 'idle', 'cheer', 'hover', 'sway', 'flicker', 'pulse', 'drift', 'bob', 'spin'];
export const EFFECT_TYPES = {
  blink: 'points', glow: 'box', screen: 'box', hologram: 'box', steam: 'point', smoke: 'point',
  sparks: 'point', torch: 'point', drip: 'points', searchlight: 'point', traffic: 'box', birds: 'box',
  clouds: 'box', fog: 'box', lightning: 'box', ripples: 'box', shimmer: 'box', wave: 'box',
  spin: 'box', flash: 'box', embers: 'box', fireflies: 'box'
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const fraction = (value, label, low = -1, high = 2) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) throw new Error(`${label} must be a number between ${low} and ${high}.`);
  return value;
};
const text = (value, label) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 120) throw new Error(`${label} must be text of at most 120 characters.`);
  return value.trim();
};

// A stage's weather and ambient effects, as assets.json carries them on game.stages[].scenery.
export function validateScenery(value, owner = 'stage') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Scenery for ${owner} must be an object.`);
  const weather = value.weather ?? 'none';
  if (!SCENERY_WEATHER.includes(weather)) throw new Error(`Unknown scenery weather for ${owner}: ${weather}`);
  const effects = value.effects ?? [];
  if (!Array.isArray(effects) || effects.length > 64) throw new Error(`Scenery effects for ${owner} must be a list of at most 64 effects.`);
  const ids = new Set();
  const checked = effects.map((effect, index) => {
    const geometry = EFFECT_TYPES[effect?.type];
    if (!geometry) throw new Error(`Unknown scenery effect for ${owner}: ${effect?.type}`);
    const id = effect.id ?? `fx${index + 1}`;
    if (!ID.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate effect id for ${owner}: ${id}`);
    ids.add(id);
    const item = { id, type: effect.type }, point = p => ({ x: fraction(p?.x, `${id} point x`, 0, 1), y: fraction(p?.y, `${id} point y`, 0, 1) });
    if (geometry === 'box') {
      item.box = Object.fromEntries(['x', 'y', 'w', 'h'].map(key => [key, fraction(effect.box?.[key], `${id} box.${key}`, 0, 1)]));
      if (item.box.w <= 0 || item.box.h <= 0) throw new Error(`${id} needs a box with a positive size.`);
    } else if (geometry === 'point') item.point = point(effect.point);
    else {
      if (!Array.isArray(effect.points) || !effect.points.length || effect.points.length > 16) throw new Error(`${id} needs between 1 and 16 points.`);
      item.points = effect.points.map(point);
    }
    if (effect.color !== undefined) {
      if (typeof effect.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(effect.color)) throw new Error(`${id} color must be #RRGGBB.`);
      item.color = effect.color.toLowerCase();
    }
    const label = text(effect.label, `${id} label`); if (label) item.label = label;
    return item;
  });
  return { weather, effects: checked };
}

// The placement fields of one cut-out stage element (an assets.json `layer` record or a layout element).
export function validateLayer(item, owner = item?.id) {
  const place = item?.place;
  if (!place || typeof place !== 'object') throw new Error(`${owner} needs a place {x, y, w, h} in stage fractions.`);
  for (const key of ['x', 'y', 'w', 'h']) fraction(place[key], `${owner} place.${key}`);
  if (place.w <= 0 || place.h <= 0) throw new Error(`${owner} needs a place with a positive size.`);
  if (!LAYER_MOTIONS.includes(item.motion ?? 'idle')) throw new Error(`${owner} has an unknown motion: ${item.motion}`);
  if (item.order !== undefined && (!Number.isInteger(item.order) || item.order < 0 || item.order > 999)) throw new Error(`${owner} order must be an integer from 0 to 999.`);
  text(item.label, `${owner} label`);
  return { place: { x: place.x, y: place.y, w: place.w, h: place.h }, motion: item.motion ?? 'idle', order: item.order ?? 0, ...(item.label ? { label: item.label.trim() } : {}) };
}
