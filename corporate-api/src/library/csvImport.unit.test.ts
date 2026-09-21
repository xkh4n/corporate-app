import { describe, expect, it } from "vitest";
import { CsvFormatError, IMPORT_MAX_ROWS, parseCsv, toCsvCell, toCsvLine, validateImportCsv } from "./csvImport";

const HEADER = "serial_number,product,category,cost_center_code,status,assigned_username,assigned_rut,warranty_expires_at";

describe("parseCsv", () => {
  it("parsea comas, comillas dobles y saltos de linea dentro de comillas", () => {
    const records = parseCsv('a,"b, con coma","linea1\nlinea2","comilla ""doble"""\n1,2,3,4\n');
    expect(records).toEqual([
      ["a", "b, con coma", "linea1\nlinea2", 'comilla "doble"'],
      ["1", "2", "3", "4"],
    ]);
  });

  it("detecta el punto y coma como separador y tolera BOM y CRLF", () => {
    expect(parseCsv("﻿a;b;c\r\n1;2;3\r\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("no cuenta las comas dentro de comillas al detectar el separador", () => {
    expect(parseCsv('"a,b,c";d\n1;2')).toEqual([
      ["a,b,c", "d"],
      ["1", "2"],
    ]);
  });

  it("ignora las lineas vacias y acepta la ultima sin salto de linea", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("conserva una celda vacia final", () => {
    expect(parseCsv("a,b,\n1,2,")).toEqual([
      ["a", "b", ""],
      ["1", "2", ""],
    ]);
  });

  it("rechaza comillas sin cerrar y comillas dentro de una celda sin comillar", () => {
    expect(() => parseCsv('a,"b\n1,2')).toThrow(CsvFormatError);
    expect(() => parseCsv('a,b"c,d')).toThrow(CsvFormatError);
  });

  it("rechaza un registro con demasiadas columnas (2 MB de comas no debe gastar memoria)", () => {
    expect(() => parseCsv(`a,${",".repeat(5000)}`)).toThrow(/más de 32 columnas/);
    expect(parseCsv(`${"a,".repeat(31)}a`)[0]).toHaveLength(32);
  });

  it("rechaza una celda gigante y demasiadas filas", () => {
    expect(() => parseCsv(`a,${"x".repeat(400)}`)).toThrow(CsvFormatError);
    const many = ["a"].concat(Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => String(i))).join("\n");
    expect(() => parseCsv(many)).toThrow(CsvFormatError);
  });
});

describe("validateImportCsv", () => {
  const csv = (...lines: string[]) => [HEADER, ...lines].join("\n");

  it("acepta una fila minima y aplica los valores por defecto", () => {
    const { rows, issues, totalRows } = validateImportCsv(csv("SN-1,Notebook Lenovo,,5802,,,,"));
    expect(issues).toEqual([]);
    expect(totalRows).toBe(1);
    expect(rows).toEqual([
      {
        row: 2,
        serialNumber: "SN-1",
        product: "Notebook Lenovo",
        category: null,
        costCenterCode: 5802,
        statusCode: "AVAILABLE",
        assignedUsername: null,
        assignedRut: null,
        warrantyExpiresAt: null,
      },
    ]);
  });

  it("acepta una cabecera con solo las columnas obligatorias y en cualquier orden", () => {
    const { rows } = validateImportCsv("cost_center_code;serial_number;product\n5802;SN-9;Mouse");
    expect(rows[0]).toMatchObject({ serialNumber: "SN-9", product: "Mouse", costCenterCode: 5802 });
  });

  it("normaliza el estado a mayusculas y exige usuario solo para ASSIGNED", () => {
    const ok = validateImportCsv(csv("SN-1,P,,1,assigned,jperez,,2027-12-31"));
    expect(ok.issues).toEqual([]);
    expect(ok.rows[0]).toMatchObject({ statusCode: "ASSIGNED", assignedUsername: "jperez", warrantyExpiresAt: "2027-12-31" });

    const sinUsuario = validateImportCsv(csv("SN-1,P,,1,ASSIGNED,,,"));
    expect(sinUsuario.issues.map((issue) => issue.message)).toEqual(["Un equipo ASSIGNED requiere assigned_username o assigned_rut"]);

    const dosUsuarios = validateImportCsv(csv("SN-1,P,,1,ASSIGNED,jperez,11.111.111-1,"));
    expect(dosUsuarios.issues[0]?.column).toBe("assigned_rut");

    const usuarioSinAsignar = validateImportCsv(csv("SN-1,P,,1,AVAILABLE,jperez,,"));
    expect(usuarioSinAsignar.issues[0]?.message).toContain("solo aplica al estado ASSIGNED");
  });

  it("rechaza DECOMMISSIONED, estados desconocidos, fechas imposibles y centros de costo no enteros", () => {
    const { issues } = validateImportCsv(
      csv("SN-1,P,,1,DECOMMISSIONED,,,", "SN-2,P,,1,,,,2027-02-30", "SN-3,P,,abc,,,,", "SN-4,P,,1,,,,31/12/2027"),
    );
    expect(issues.map((issue) => `${issue.row}:${issue.column}`)).toEqual([
      "2:status",
      "3:warranty_expires_at",
      "4:cost_center_code",
      "5:warranty_expires_at",
    ]);
  });

  it("detecta series repetidas dentro del archivo sin distinguir mayusculas ni espacios de borde", () => {
    const { rows, issues } = validateImportCsv(csv("SN-1,P,,1,,,,", " sn-1 ,P,,1,,,,", "SN-2,P,,1,,,,"));
    expect(rows.map((row) => row.serialNumber)).toEqual(["SN-1", "SN-2"]);
    expect(issues).toEqual([{ row: 3, column: "serial_number", message: "Serie repetida en el archivo (ya está en la fila 2)" }]);
  });

  it("rechaza series con caracteres fuera del alfabeto permitido", () => {
    const { issues } = validateImportCsv(csv("SN;1,P,,1,,,,", "SN'1,P,,1,,,,"));
    expect(issues.filter((issue) => issue.column === "serial_number")).toHaveLength(2);
  });

  it("rechaza celdas que una planilla leeria como formula", () => {
    const { issues } = validateImportCsv(csv('SN-1,"=HYPERLINK(""http://x"")",,1,,,,', "SN-2,+cmd,,1,,,,", "@SN-3,P,,1,,,,"));
    expect(issues.map((issue) => `${issue.row}:${issue.column}`)).toEqual(["2:product", "3:product", "4:serial_number", "4:serial_number"]);
  });

  it("rechaza filas con mas celdas que la cabecera sin cortar las demas", () => {
    const { rows, issues } = validateImportCsv(csv("SN-1,P,,1,,,,,extra", "SN-2,P,,1,,,,"));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ row: 2, column: "-" });
    expect(rows.map((row) => row.serialNumber)).toEqual(["SN-2"]);
  });

  it("rechaza el archivo completo si la cabecera es invalida", () => {
    expect(() => validateImportCsv("serial_number,product\nSN-1,P")).toThrow(/Faltan columnas obligatorias: cost_center_code/);
    expect(() => validateImportCsv("serial_number,product,cost_center_code,value\nSN-1,P,1,10")).toThrow(/Columna desconocida/);
    expect(() => validateImportCsv("serial_number,serial_number,product,cost_center_code\n1,1,P,1")).toThrow(/repetida/);
    expect(() => validateImportCsv("")).toThrow(/vacío/);
    expect(() => validateImportCsv(HEADER)).toThrow(/no tiene filas de datos/);
  });
});

describe("toCsvCell / toCsvLine", () => {
  it("escapa comillas, separadores y saltos de linea", () => {
    expect(toCsvCell('a "b"')).toBe('"a ""b"""');
    expect(toCsvCell("a,b")).toBe('"a,b"');
    expect(toCsvCell("a\nb")).toBe('"a\nb"');
    expect(toCsvCell(null)).toBe("");
    expect(toCsvCell(12)).toBe("12");
  });

  it("neutraliza celdas que una planilla leeria como formula", () => {
    expect(toCsvCell("=1+1")).toBe("'=1+1");
    expect(toCsvCell("@x")).toBe("'@x");
    expect(toCsvLine(["OK", "-5", "ACT000000001"])).toBe("OK,'-5,ACT000000001");
    // Con espacios o saltos de linea antes del signo, que una planilla ignora al evaluar.
    expect(toCsvCell(" =1+1")).toBe("' =1+1");
    expect(toCsvCell(" @x")).toBe("' @x");
    expect(toCsvCell("\n=1")).toBe('"\'\n=1"');
    expect(toCsvCell("texto = normal")).toBe("texto = normal");
  });
});
