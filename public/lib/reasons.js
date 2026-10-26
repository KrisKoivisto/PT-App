// Quick reasons shown after you react, picked to fit the kind of title. A true
// crime doc and a sitcom are good or bad for different reasons.
const SETS = {
  truecrime: {
    label: 'True crime',
    good: ['Gripping case', 'Well researched', 'Great interviews', 'Shocking twists', 'Bingeable', 'Justice served'],
    bad: ['Too graphic', 'Dragged on', 'Exploitative', 'One-sided', 'Left unresolved', 'Too many reenactments'],
  },
  doc: {
    label: 'Documentary',
    good: ['Learned a lot', 'Eye-opening', 'Great interviews', 'Beautifully made', 'Bingeable'],
    bad: ['Too slow', 'One-sided', 'Dry', 'Too long', 'Nothing new'],
  },
  reality: {
    label: 'Reality',
    good: ['Addictive', 'Great drama', 'Guilty pleasure', 'Great cast', 'Funny'],
    bad: ['Too staged', 'Mean-spirited', 'Boring cast', 'Repetitive'],
  },
  horror: {
    label: 'Horror',
    good: ['Actually scary', 'Creepy atmosphere', 'Great twist', 'Fun ride'],
    bad: ['Not scary', 'Too gory', 'Cheap jump scares', 'Dumb choices', 'Bad ending'],
  },
  family: {
    label: 'Family',
    good: ['Fun for everyone', 'Heartwarming', 'Funny', 'Beautiful animation'],
    bad: ['Too childish', 'Annoying', 'Boring', 'Too scary for kids'],
  },
  romance: {
    label: 'Romance',
    good: ['Great chemistry', 'Swoon-worthy', 'Funny', 'Feel-good', 'Made me cry'],
    bad: ['Cheesy', 'No chemistry', 'Predictable', 'Annoying leads'],
  },
  comedy: {
    label: 'Comedy',
    good: ['Laughed out loud', 'Clever writing', 'Great cast', 'Feel-good', 'Rewatchable'],
    bad: ['Not funny', 'Cringe', 'Tried too hard', 'Dated jokes', 'Dragged'],
  },
  spectacle: {
    label: 'Action & sci-fi',
    good: ['Epic action', 'Great world', 'Mind-bending', 'Looks amazing', 'Fun ride'],
    bad: ['Confusing', 'CGI overload', 'Dumb plot', 'Too long', 'Bad ending'],
  },
  crime: {
    label: 'Crime & thriller',
    good: ['Edge of my seat', 'Great twists', 'Great acting', 'Smart plot', 'Bingeable'],
    bad: ['Predictable', 'Too slow', 'Too violent', 'Plot holes', 'Bad ending'],
  },
  drama: {
    label: 'Drama',
    good: ['Great story', 'Great acting', 'Moving', 'Beautifully shot', 'Characters'],
    bad: ['Too slow', 'Boring', 'Too dark', 'Bad acting', 'Bad ending'],
  },
};

// First match wins, so the more specific kinds come first.
export function kindOf(item) {
  const g = new Set((item.genres ?? []).map((x) => x.toLowerCase()));
  const has = (...names) => names.some((n) => g.has(n));
  if (has('documentary') && has('crime')) return 'truecrime';
  if (has('documentary')) return 'doc';
  if (has('reality')) return 'reality';
  if (has('horror')) return 'horror';
  if (has('animation', 'family', 'kids')) return 'family';
  if (has('romance')) return 'romance';
  if (has('comedy')) return 'comedy';
  if (has('action', 'adventure', 'science fiction', 'fantasy', 'action & adventure', 'sci-fi & fantasy')) return 'spectacle';
  if (has('crime', 'thriller', 'mystery')) return 'crime';
  return 'drama';
}

// Reasons to offer for a reaction. Anything already picked stays visible even
// if it came from another list (say the title's genres changed on TMDB).
export function reasonsFor(item, reaction, picked = []) {
  const set = SETS[kindOf(item)];
  const list = reaction === 'dislike' ? [...set.bad, "Didn't finish"] : set.good;
  return [...list, ...picked.filter((r) => !list.includes(r))];
}
