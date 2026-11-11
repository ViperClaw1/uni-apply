function getByPath(obj, path) {
  return path.split(".").reduce((acc, key) => {
    if (acc == null) {
      return void 0;
    }
    if (Array.isArray(acc)) {
      const index = Number(key);
      return Number.isInteger(index) ? acc[index] : void 0;
    }
    if (typeof acc === "object" && key in acc) {
      return acc[key];
    }
    return void 0;
  }, obj);
}
export function mapsToPaths(mapsTo) {
  if (!mapsTo) {
    return [];
  }
  return Array.isArray(mapsTo) ? mapsTo.filter(Boolean) : [mapsTo];
}
export function getFieldValue(profile, field, motivationLetterContent) {
  if (field.type === "essay" && !field.mapsTo) {
    return motivationLetterContent;
  }
  const paths = mapsToPaths(field.mapsTo);
  if (paths.length === 0) {
    return void 0;
  }
  for (const path of paths) {
    const value = getByPath(profile, path);
    if (value !== void 0 && value !== null && value !== "") {
      return value;
    }
  }
  return void 0;
}
export function fieldsForStep(schema, step) {
  return schema.fields.filter((field) => (field.wizardStep ?? 1) === step);
}
export function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return ["true", "yes", "да", "1"].includes(String(value).toLowerCase());
}
