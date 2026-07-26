function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

export function parseInventoryCsv(content) {
  const text = String(content || "").replace(/^\uFEFF/, "").trim();
  if (!text) return { rows: [], errors: ["Choose a non-empty CSV file."] };

  let records;
  try {
    records = parseCsv(text);
  } catch (error) {
    return { rows: [], errors: [error.message] };
  }

  const [headerRow, ...dataRows] = records;
  const headers = headerRow.map((header) => String(header || "").trim().toLowerCase());
  const requiredHeaders = ["name", "category", "unit price", "selling price", "status"];
  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length) {
    return { rows: [], errors: [`Missing required column${missingHeaders.length === 1 ? "" : "s"}: ${missingHeaders.join(", ")}.`] };
  }

  const column = (name) => headers.indexOf(name);
  const valueAt = (row, name) => {
    const index = column(name);
    return index >= 0 ? String(row[index] || "").trim() : "";
  };
  const rows = [];
  const errors = [];

  dataRows.forEach((row, index) => {
    const rowNumber = index + 2;
    if (!row.some((value) => String(value || "").trim())) return;
    if (row.length > headers.length) {
      errors.push(`Row ${rowNumber}: contains more values than the header row.`);
      return;
    }
    rows.push({
      rowNumber,
      barcode: valueAt(row, "barcode"),
      name: valueAt(row, "name"),
      category: valueAt(row, "category"),
      supplier: valueAt(row, "supplier"),
      stockQuantity: valueAt(row, "stock quantity"),
      unitPrice: valueAt(row, "unit price"),
      sellingPrice: valueAt(row, "selling price"),
      reorderLevel: valueAt(row, "reorder level"),
      status: valueAt(row, "status")
    });
  });

  if (!rows.length && !errors.length) errors.push("The CSV does not contain any product rows.");
  return { rows, errors };
}
