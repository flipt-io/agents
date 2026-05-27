// Lets TypeScript understand Flue's static skill imports, e.g.
//   import review from '../skills/review/SKILL.md' with { type: 'skill' };
// The Flue build (Vite) resolves the real SkillReference at build time; this
// ambient declaration just keeps the editor and `tsc` happy.
declare module '*.md' {
  // Typed loosely on purpose so the value is assignable to Flue's `skills: [...]`.
  const skill: any;
  export default skill;
}
