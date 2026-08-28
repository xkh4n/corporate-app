import { QueryTypes, Transaction } from "sequelize";
import { mssql } from "../databases/mssql/connection";

const PAD_LENGTH = 9;

export type DocumentType = "SOL" | "COT" | "OC";

interface NextSeqRow {
  next_seq: number;
}

// Incremento atomico dentro de la MISMA transaccion que la cabecera del
// documento (PurchaseRequest/Quote/PurchaseOrder) -evita que dos requests
// concurrentes generen el mismo numero, y si la transaccion de la cabecera
// hace rollback, el numero tambien se revierte (a diferencia de una
// secuencia de motor, que no hace rollback y deja "huecos"). Ver memoria
// convention-pk-id-strategy.
export async function generateDocumentNumber(docType: DocumentType, transaction: Transaction): Promise<string> {
  const rows = await mssql.query<NextSeqRow>(
    `UPDATE document_numbering SET next_seq = next_seq + 1 OUTPUT INSERTED.next_seq AS next_seq WHERE doc_type = :docType`,
    { replacements: { docType }, type: QueryTypes.SELECT, transaction },
  );
  const nextSeq = rows[0]?.next_seq;
  if (nextSeq === undefined) {
    throw new Error(`No existe contador de numeracion para el tipo de documento '${docType}'`);
  }
  return `${docType}${String(nextSeq).padStart(PAD_LENGTH, "0")}`;
}
