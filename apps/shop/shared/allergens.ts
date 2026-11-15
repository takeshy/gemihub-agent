/** The eight allergens Japan requires on labels, plus "other" for anything explained in a note. */
export const allergenIds = ["egg", "milk", "wheat", "buckwheat", "peanut", "shrimp", "crab", "walnut", "other"] as const;
export type Allergen = typeof allergenIds[number];
/** Words guests use for the eight labelled allergens, in Japanese (kana already folded to hiragana) and English. */
export const allergenWords: Record<Exclude<Allergen, "other">, string[]> = {
  egg: ["egg", "eggs", "卵", "たまご", "玉子", "鶏卵"],
  milk: ["milk", "dairy", "乳", "牛乳", "乳製品", "みるく"],
  wheat: ["wheat", "小麦", "小麦粉", "こむぎ"],
  buckwheat: ["buckwheat", "soba", "そば", "蕎麦"],
  peanut: ["peanut", "peanuts", "落花生", "ぴーなっつ", "ぴーなつ"],
  shrimp: ["shrimp", "shrimps", "prawn", "prawns", "えび", "海老", "蝦"],
  crab: ["crab", "crabs", "かに", "蟹"],
  walnut: ["walnut", "walnuts", "くるみ", "胡桃"],
};
/** Allergen names as the owner's screens and the storefront show them. */
export const allergenLabels: Record<Allergen, { ja: string; en: string }> = {
  egg: { ja: "卵", en: "Egg" }, milk: { ja: "乳", en: "Milk" }, wheat: { ja: "小麦", en: "Wheat" }, buckwheat: { ja: "そば", en: "Buckwheat" },
  peanut: { ja: "落花生", en: "Peanut" }, shrimp: { ja: "えび", en: "Shrimp" }, crab: { ja: "かに", en: "Crab" }, walnut: { ja: "くるみ", en: "Walnut" }, other: { ja: "その他", en: "Other" },
};
