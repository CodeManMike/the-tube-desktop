// A transform receives parsed YouTube JSON and returns it (mutated or replaced).
// It must be self-contained: the in-page candidate serialises it with toString().
export type Transform = (data: any) => any;

export type Rule = { name: string; transform: Transform };
