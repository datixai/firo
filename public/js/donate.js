/**
 * donate.js
 * ─────────────────────────────────────────────────────────────
 * Shared by /donate and the admin panel.
 *
 * Collections
 *   donation_pledges  the Donate form: who wants to give, how much,
 *                     for what, plus an optional message or prayer
 *                     request (private: admins only)
 *   donation_records  donations actually received, recorded by an
 *                     admin: amount (PKR), category, date (public,
 *                     no names or contact details)
 *   donation_uses     how the money was spent (public)
 * ─────────────────────────────────────────────────────────────
 */

export const CATEGORIES = {
  plantation: { label: "Tree plantation",        icon: "fa-seedling",          text: "Planting native trees on burned and bare slopes." },
  equipment:  { label: "Firefighting equipment", icon: "fa-fire-extinguisher", text: "Beaters, blowers, protective gear and first aid for forest teams." },
  cameras:    { label: "Early-warning cameras",  icon: "fa-video",             text: "More FIRO cameras watching more of the forest." },
  awareness:  { label: "Community awareness",    icon: "fa-people-group",      text: "Fire-safety sessions in schools and villages." },
  wildlife:   { label: "Wildlife & forest care", icon: "fa-paw",               text: "Care for animals and habitats hurt by fires." },
  general:    { label: "Where it's needed most", icon: "fa-hand-holding-heart", text: "Let the team decide where it helps most." },
};

export const CURRENCIES = ["PKR", "USD", "GBP", "EUR", "SAR", "AED"];

/** "PKR 1,250,000" */
export const money = (n, cur = "PKR") => `${cur} ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

/** Sum records by year → { 2026: { total, byCategory: { plantation: n, … }, count } } */
export function totalsByYear(records) {
  const out = {};
  for (const r of records) {
    const y = r.year || new Date(r.received_ms || Date.now()).getFullYear();
    const t = (out[y] ||= { total: 0, count: 0, byCategory: {} });
    t.total += Number(r.amount) || 0;
    t.count += 1;
    t.byCategory[r.category] = (t.byCategory[r.category] || 0) + (Number(r.amount) || 0);
  }
  return out;
}
