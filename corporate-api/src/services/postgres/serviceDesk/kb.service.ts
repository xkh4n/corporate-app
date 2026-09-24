import { QueryTypes } from "sequelize";
import { postgres } from "../../../databases/postgres/connection";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../../library/errors";
import type { PaginationParams } from "../../../library/pagination";
import { getOffset } from "../../../library/pagination";
import { getUserDirectory } from "../../mssql/user.service";
import { nextServiceDeskNumber } from "./numbering";

// Gestion del conocimiento (plan 009, fase 9E). Ciclo: DRAFT -> IN_REVIEW ->
// PUBLISHED (con version) -> RETIRED. El cuerpo es texto plano: el front lo
// muestra escapado, nunca como HTML.

export type KbAudience = "PUBLIC" | "INTERNAL";
export type KbStatus = "DRAFT" | "IN_REVIEW" | "PUBLISHED" | "RETIRED";

export interface KbArticleSummary {
  id: number;
  number: string;
  title: string;
  categoryId: number | null;
  categoryName: string | null;
  audience: KbAudience;
  status: KbStatus;
  version: number;
  authorId: number;
  authorName: string | null;
  publishedAt: Date | null;
  helpfulYes: number;
  helpfulNo: number;
  views: number;
  updatedAt: Date;
}

export interface KbArticle extends KbArticleSummary {
  body: string;
  sourceProblemId: number | null;
  sourceProblemNumber: string | null;
}

const SUMMARY_COLUMNS = `
  k.id, k.number, k.title, k.category_id AS "categoryId", c.name AS "categoryName", k.audience, k.status, k.version,
  k.author_id AS "authorId", k.published_at AS "publishedAt", k.helpful_yes AS "helpfulYes", k.helpful_no AS "helpfulNo",
  k.views, k.updated_at AS "updatedAt"
`;
const FROM = `FROM kb_articles k LEFT JOIN service_categories c ON c.id = k.category_id`;

async function withAuthors<T extends { authorId: number }>(rows: T[]): Promise<(T & { authorName: string | null })[]> {
  const directory = await getUserDirectory(rows.map((row) => row.authorId));
  return rows.map((row) => ({ ...row, authorName: directory.get(row.authorId)?.fullName ?? null }));
}

// Busqueda en articulos publicados. PUBLIC: lo que ve el portal; INTERNAL: el agente ve ambos.
// anyTerm: basta con que coincida una palabra (sugerencias a partir de un titulo); si no, todas.
export async function searchPublished(
  search: string,
  options: { audience: KbAudience; limit: number; anyTerm?: boolean },
): Promise<(KbArticleSummary & { snippet: string })[]> {
  const term = search.trim();
  const audienceSql = options.audience === "PUBLIC" ? "AND k.audience = 'PUBLIC'" : "";
  const rows = term
    ? await postgres.query<KbArticleSummary & { snippet: string }>(
        `SELECT ${SUMMARY_COLUMNS}, left(k.body, 240) AS snippet ${FROM}
           CROSS JOIN (SELECT ${
             options.anyTerm
               ? "NULLIF(replace(plainto_tsquery('spanish', :term)::text, '&', '|'), '')::tsquery"
               : "websearch_to_tsquery('spanish', :term)"
           } AS q) tq
          WHERE k.status = 'PUBLISHED' ${audienceSql} AND k.search_vector @@ tq.q
          ORDER BY ts_rank(k.search_vector, tq.q) DESC, k.helpful_yes DESC LIMIT :limit`,
        { replacements: { term, limit: options.limit }, type: QueryTypes.SELECT },
      )
    : await postgres.query<KbArticleSummary & { snippet: string }>(
        `SELECT ${SUMMARY_COLUMNS}, left(k.body, 240) AS snippet ${FROM}
          WHERE k.status = 'PUBLISHED' ${audienceSql} ORDER BY k.views DESC, k.id DESC LIMIT :limit`,
        { replacements: { limit: options.limit }, type: QueryTypes.SELECT },
      );
  return withAuthors(rows);
}

async function findArticle(id: number): Promise<KbArticle | null> {
  const [row] = await postgres.query<Omit<KbArticle, "authorName">>(
    `SELECT ${SUMMARY_COLUMNS}, k.body, k.source_problem_id AS "sourceProblemId", p.number AS "sourceProblemNumber"
       ${FROM} LEFT JOIN service_problems p ON p.id = k.source_problem_id WHERE k.id = :id`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
  if (!row) return null;
  const [withAuthor] = await withAuthors([row]);
  return withAuthor!;
}

// Lectura de un publicado (suma una vista). El portal no ve los INTERNAL.
export async function getPublishedArticle(id: number, audience: KbAudience): Promise<KbArticle> {
  const article = await findArticle(id);
  if (!article || article.status !== "PUBLISHED" || (audience === "PUBLIC" && article.audience !== "PUBLIC")) {
    throw new NotFoundError(`El articulo ${id} no existe`);
  }
  await postgres.query(`UPDATE kb_articles SET views = views + 1 WHERE id = :id`, { replacements: { id } });
  return article;
}

export async function recordFeedback(id: number, userId: number, helpful: boolean, audience: KbAudience): Promise<void> {
  await postgres.transaction(async (transaction) => {
    const [article] = await postgres.query<{ status: KbStatus; audience: KbAudience }>(
      `SELECT status, audience FROM kb_articles WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    if (!article || article.status !== "PUBLISHED" || (audience === "PUBLIC" && article.audience !== "PUBLIC")) {
      throw new NotFoundError(`El articulo ${id} no existe`);
    }
    await postgres.query(
      `INSERT INTO kb_article_feedback (article_id, user_id, helpful) VALUES (:id, :userId, :helpful)
       ON CONFLICT (article_id, user_id) DO UPDATE SET helpful = EXCLUDED.helpful, created_at = now()`,
      { replacements: { id, userId, helpful }, transaction },
    );
    await postgres.query(
      `UPDATE kb_articles SET
         helpful_yes = (SELECT COUNT(*) FROM kb_article_feedback WHERE article_id = :id AND helpful),
         helpful_no = (SELECT COUNT(*) FROM kb_article_feedback WHERE article_id = :id AND NOT helpful)
       WHERE id = :id`,
      { replacements: { id }, transaction },
    );
  });
}

// ---------------------------------------------------------------------------
// Gestion (agentes)
// ---------------------------------------------------------------------------
export async function listArticles(
  params: PaginationParams,
  filters: { status?: KbStatus },
): Promise<{ items: KbArticleSummary[]; total: number }> {
  const conditions: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (filters.status) {
    conditions.push("k.status = :status");
    replacements.status = filters.status;
  }
  if (params.search) {
    conditions.push("(k.number ILIKE :like OR k.title ILIKE :like OR k.search_vector @@ websearch_to_tsquery('spanish', :term))");
    replacements.like = `%${params.search}%`;
    replacements.term = params.search;
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const [countRow] = await postgres.query<{ total: number }>(`SELECT COUNT(*)::int AS total ${FROM} ${where}`, {
    replacements,
    type: QueryTypes.SELECT,
  });
  const rows = await postgres.query<KbArticleSummary>(
    `SELECT ${SUMMARY_COLUMNS} ${FROM} ${where} ORDER BY k.updated_at DESC, k.id DESC LIMIT :limit OFFSET :offset`,
    { replacements: { ...replacements, limit: params.limit, offset: getOffset(params) }, type: QueryTypes.SELECT },
  );
  return { items: await withAuthors(rows), total: countRow?.total ?? 0 };
}

export async function getArticleOrThrow(id: number): Promise<KbArticle> {
  const article = await findArticle(id);
  if (!article) throw new NotFoundError(`El articulo ${id} no existe`);
  return article;
}

export interface ArticleInput {
  title: string;
  body: string;
  categoryId?: number | null;
  audience: KbAudience;
  sourceProblemId?: number | null;
}

export async function createArticle(input: ArticleInput, userId: number): Promise<KbArticle> {
  const id = await postgres.transaction(async (transaction) => {
    const number = await nextServiceDeskNumber("KB", transaction);
    const [row] = await postgres.query<{ id: number }>(
      `INSERT INTO kb_articles (number, title, body, category_id, audience, status, author_id, source_problem_id)
       VALUES (:number, :title, :body, :categoryId, :audience, 'DRAFT', :userId, :sourceProblemId) RETURNING id`,
      {
        replacements: {
          number,
          title: input.title,
          body: input.body,
          categoryId: input.categoryId ?? null,
          audience: input.audience,
          userId,
          sourceProblemId: input.sourceProblemId ?? null,
        },
        type: QueryTypes.SELECT,
        transaction,
      },
    );
    return row!.id;
  });
  return getArticleOrThrow(id);
}

// Editar un publicado lo devuelve a borrador: la version vigente queda en el historial.
export async function updateArticle(id: number, input: ArticleInput): Promise<KbArticle> {
  await postgres.transaction(async (transaction) => {
    const [row] = await postgres.query<{ status: KbStatus }>(`SELECT status FROM kb_articles WHERE id = :id FOR UPDATE`, {
      replacements: { id },
      type: QueryTypes.SELECT,
      transaction,
    });
    if (!row) throw new NotFoundError(`El articulo ${id} no existe`);
    if (row.status === "RETIRED") throw new ConflictError("El articulo esta retirado: cree uno nuevo");
    await postgres.query(
      `UPDATE kb_articles SET title = :title, body = :body, category_id = :categoryId, audience = :audience,
              status = 'DRAFT', updated_at = now() WHERE id = :id`,
      {
        replacements: { id, title: input.title, body: input.body, categoryId: input.categoryId ?? null, audience: input.audience },
        transaction,
      },
    );
  });
  return getArticleOrThrow(id);
}

export async function changeArticleStatus(
  id: number,
  target: "IN_REVIEW" | "PUBLISHED" | "RETIRED" | "DRAFT",
  actor: { userId: number; canApprove: boolean },
): Promise<KbArticle> {
  await postgres.transaction(async (transaction) => {
    const [row] = await postgres.query<{ status: KbStatus; title: string; body: string; version: number }>(
      `SELECT status, title, body, version FROM kb_articles WHERE id = :id FOR UPDATE`,
      { replacements: { id }, type: QueryTypes.SELECT, transaction },
    );
    if (!row) throw new NotFoundError(`El articulo ${id} no existe`);
    const allowed: Record<KbStatus, KbStatus[]> = {
      DRAFT: ["IN_REVIEW", "PUBLISHED", "RETIRED"],
      IN_REVIEW: ["DRAFT", "PUBLISHED", "RETIRED"],
      PUBLISHED: ["RETIRED", "DRAFT"],
      RETIRED: [],
    };
    if (!allowed[row.status].includes(target)) throw new ConflictError(`No se puede pasar de ${row.status} a ${target}`);
    if ((target === "PUBLISHED" || target === "RETIRED") && !actor.canApprove) {
      throw new ForbiddenError("Publicar o retirar un articulo requiere el permiso 'kb-articles:approve'");
    }
    if (target === "PUBLISHED") {
      if (row.body.trim().length < 20) throw new BadRequestError("El articulo es demasiado corto para publicarse");
      const version = row.version + 1;
      await postgres.query(
        `UPDATE kb_articles SET status = 'PUBLISHED', version = :version, published_by = :userId, published_at = now(),
                updated_at = now() WHERE id = :id`,
        { replacements: { id, version, userId: actor.userId }, transaction },
      );
      await postgres.query(
        `INSERT INTO kb_article_versions (article_id, version, title, body, published_by) VALUES (:id, :version, :title, :body, :userId)`,
        { replacements: { id, version, title: row.title, body: row.body, userId: actor.userId }, transaction },
      );
    } else {
      await postgres.query(`UPDATE kb_articles SET status = :target, updated_at = now() WHERE id = :id`, {
        replacements: { id, target },
        transaction,
      });
    }
  });
  return getArticleOrThrow(id);
}

export async function listArticleVersions(id: number): Promise<{ version: number; title: string; publishedBy: number; publishedAt: Date }[]> {
  return postgres.query(
    `SELECT version, title, published_by AS "publishedBy", published_at AS "publishedAt"
       FROM kb_article_versions WHERE article_id = :id ORDER BY version DESC`,
    { replacements: { id }, type: QueryTypes.SELECT },
  );
}

// Vincular un articulo a un ticket (y opcionalmente marcarlo como la solucion).
export async function linkArticleToTicket(ticketId: number, articleId: number, usedToResolve: boolean, userId: number): Promise<void> {
  const [article] = await postgres.query<{ status: KbStatus; number: string }>(`SELECT status, number FROM kb_articles WHERE id = :articleId`, {
    replacements: { articleId },
    type: QueryTypes.SELECT,
  });
  if (!article || article.status !== "PUBLISHED") throw new BadRequestError("Solo se vinculan articulos publicados");
  await postgres.transaction(async (transaction) => {
    const [ticket] = await postgres.query(`SELECT id FROM service_tickets WHERE id = :ticketId FOR UPDATE`, {
      replacements: { ticketId },
      type: QueryTypes.SELECT,
      transaction,
    });
    if (!ticket) throw new NotFoundError(`El ticket ${ticketId} no existe`);
    await postgres.query(
      `INSERT INTO service_ticket_kb (ticket_id, article_id, used_to_resolve, linked_by) VALUES (:ticketId, :articleId, :usedToResolve, :userId)
       ON CONFLICT (ticket_id, article_id) DO UPDATE SET used_to_resolve = EXCLUDED.used_to_resolve`,
      { replacements: { ticketId, articleId, usedToResolve, userId }, transaction },
    );
    await postgres.query(
      `INSERT INTO service_ticket_events (ticket_id, event_type, actor_user_id, is_public, payload)
       VALUES (:ticketId, 'KB_ATTACHED', :userId, false, CAST(:payload AS JSONB))`,
      { replacements: { ticketId, userId, payload: JSON.stringify({ articleId, number: article.number, usedToResolve }) }, transaction },
    );
  });
}
