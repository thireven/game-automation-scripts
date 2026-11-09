// Burst — the plain clearing skills.
//
// No aiming and no follow-up: the tap is the whole activation, which is what
// lets the play loop fire these blind between chains (see Tsum.link).

registerSkill({
  types: [SkillType.Burst],
  bareTapActivates: true
});

// Same skill, on a board that leaves bubbles behind: sweep them after the clear.
//
// The generic form of what Snow White does, sweeping the same full play area.
// No startDelay: it waits out the user's "Skill Waiting time" instead.
//
// Also plays the retired Marie, Miss Bunny, Rabbit, Moana and Horn Hat Mickey
// ids (6.0b25), so a form saved with one keeps sweeping instead of playing as
// a plain burst.
const RetiredBubbleSkills = ['marie', 'missbunny', 'rabbit', 'moana', 'mickeyh2015'] as unknown as SkillType[];

registerSkill({
  types: [SkillType.BurstBubbles, ...RetiredBubbleSkills],
  bareTapActivates: true,
  sweepsBubbles: true,
  afterActivate: function(ts) {
    skillRandomizeAndWait(ts);
    ts.clearAllBubbles(0, 50);
  }
});
