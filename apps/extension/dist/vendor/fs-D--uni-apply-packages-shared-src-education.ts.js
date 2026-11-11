export function primaryEducation(profile) {
  const list = profile.education ?? [];
  return list.find((entry) => entry.level === "higher") ?? list.find((entry) => entry.level === "school") ?? list[0];
}
export function schoolEducation(profile) {
  const list = profile.education ?? [];
  return list.find((entry) => entry.level === "school") ?? list[0];
}
