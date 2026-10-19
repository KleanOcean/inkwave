// Keep documented shooter links working without sending ordinary tracking/debug
// parameters on the tennis homepage into an unrelated game.
const ORIGINAL_KEYS = new Set([
  'autostart', 'autopilot', 'devstage', 'map', 'time', 'difficulty', 'quality', 'mode',
  'lazycompile', 'nofullscreen', 'proglog', 'skipTitle', 'shadercheck', 'relay',
  'netmock', 'news', 'env', 'netlag', 'netjitter', 'netspike',
  'mockauto', 'mocklat', 'mockfill', 'mockmatch',
]);

export function selectGame(search = '') {
  const params = new URLSearchParams(search);
  const explicit = params.get('game');
  if (explicit === 'inkwave') return 'inkwave';
  if (explicit === 'tennis' || params.get('mode') === 'tennis') return 'tennis';
  return !explicit && [...params.keys()].some((key) => ORIGINAL_KEYS.has(key)) ? 'inkwave' : 'tennis';
}
