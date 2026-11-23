export const CATEGORIES = [
  {
    id: "smile",
    label: "Маленькая радость",
    hint: "улыбка, комплимент, тёплое слово",
    points: 5,
  },
  {
    id: "help",
    label: "Практическая помощь",
    hint: "помог с сумками, делом, дорогой",
    points: 15,
  },
  {
    id: "care",
    label: "Забота и внимание",
    hint: "выслушал, поддержал, утешил",
    points: 25,
  },
  {
    id: "big",
    label: "Большое дело",
    hint: "серьёзная помощь человеку",
    points: 50,
  },
  {
    id: "volunteer",
    label: "Волонтёрство",
    hint: "время и силы ради других",
    points: 80,
  },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

export function getCategory(id: string) {
  return CATEGORIES.find((c) => c.id === id);
}
