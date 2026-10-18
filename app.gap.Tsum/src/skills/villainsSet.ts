// Disney Villains (Set).
//
// Activates like a burst. Through most of a round its skill smokes the screen
// and turns every tsum into a big, dark villain with a neon fill: Maleficent
// green, Hades blue, Ursula purple. Hue stays steady per villain, but
// saturation swings 130-205 between tsums of one villain, so at the default
// colour read one villain split across many clusters, and only the biggest
// few are played (about half the tsums on the board).
//
// `chromaCap` 80 lets hue decide; `colorBlur` 15 keeps a neighbour's glow out
// of the sample. Offline, over a 3-minute recording: tsums in a linkable group
// per board 6.4 -> 10.9 on the neon boards and 7.0 -> 10.8 on normal ones.
//
// The button needs its own gauge read (`gauge`). The stock probe lands on the
// villains art and read full on 73% of frames, so a full gauge waited behind
// re-fires and holds. Here the gauge is a pie behind the art, filling
// clockwise from 12 o'clock: navy where empty, a cyan wash where filled. Full,
// the button glows yellow, or the pie closes before it does. During the
// skill's own effect the art goes dark and the pie refills over it, which
// this reads as not full.

// ---------------------------------------------------------------------------
// Tuning data
// ---------------------------------------------------------------------------

/**
 * The band between the button's border and its art, clockwise from just right
 * of 12 o'clock (logical px; each is read as a patch). Off 360-wide frames of
 * a 540x960 emulator.
 */
const VillainsGaugeRing: Coord[] = [
  {x: 174, y: 1557},  //   9 deg
  {x: 204, y: 1557},  //  29
  {x: 246, y: 1596},  //  67
  {x: 246, y: 1632},  //  90
  {x: 246, y: 1668},  // 113
  {x: 240, y: 1704},  // 133
  {x: 204, y: 1713},  // 153
  {x: 162, y: 1713},  // 180
  {x: 120, y: 1713},  // 207
  {x: 84, y: 1704},   // 227
  {x: 78, y: 1668},   // 247
  {x: 78, y: 1632},   // 270: filled past three quarters
  {x: 78, y: 1596},   // 293
  {x: 84, y: 1563},   // 311
  {x: 114, y: 1557},  // 327
  {x: 138, y: 1557}   // 342: the last of the pie to fill
];

/** Ring patches that must glow yellow for a full gauge, of the 16. */
const VillainsGaugeYellowMin = 8;

type VillainsGaugeTone = 'cyan' | 'navy' | 'yellow' | 'other';

function villainsGaugeTone(c: Color): VillainsGaugeTone {
  if (c.g >= 160 && c.b >= 190 && c.r <= 140) { return 'cyan'; }   // ~(32,200,237)
  if (c.g <= 140 && c.b >= 110 && c.b - c.g >= 35 && c.r <= 120) { return 'navy'; }  // ~(62,95,152)
  if (c.r >= 190 && c.g >= 140 && c.b <= 130) { return 'yellow'; }
  return 'other';
}

// Over the three recordings this came from (35 minutes of play, 10,000
// frames), every frame read full was one, the score screen aside.
function villainsGaugeClassify(colors: Color[]): SkillReadiness {
  const tones = colors.map(villainsGaugeTone);
  let yellow = 0, navy = 0;
  for (const t of tones) {
    if (t === 'yellow') { yellow++; }
    if (t === 'navy') { navy++; }
  }
  if (yellow >= VillainsGaugeYellowMin) { return SkillReadiness.Active; }
  // The pie closed: cyan either side of 12 o'clock, and nowhere navy but for
  // one patch a flying tsum may have darkened.
  if (tones[0] === 'cyan' && tones[14] === 'cyan' && tones[15] === 'cyan' && navy <= 1) {
    return SkillReadiness.Active;
  }
  return tones[11] === 'cyan' ? SkillReadiness.Almost : SkillReadiness.Far;
}

registerSkill({
  types: [SkillType.VillainsSet],
  bareTapActivates: true,
  colorBlur: 15,
  chromaCap: 80,
  gauge: {points: VillainsGaugeRing, classify: villainsGaugeClassify}
});
