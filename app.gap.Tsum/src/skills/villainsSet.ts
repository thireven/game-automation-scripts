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

/**
 * How long after `useSkill`'s tap the skill counts as still running.
 *
 * The gauge pixel sits on the button art and reads full through most of the
 * skill's own cut-in, so without this the loop re-fired it every ~250ms (142
 * of 230 firings in an hour were followed by re-fires). The game freezes for
 * 4.8-5.4s from the tap, so holding 1.8s loses nothing; a tap that did not
 * fire waits at most that long.
 */
const VillainsSetRunningMs = 1800;

registerSkill({
  types: [SkillType.VillainsSet],
  bareTapActivates: true,
  colorBlur: 15,
  chromaCap: 80,
  stillRunning: function(ts) {
    return ts.skillActivatedAt > 0 && Date.now() - ts.skillActivatedAt < VillainsSetRunningMs;
  }
});
