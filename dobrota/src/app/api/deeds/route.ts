import { getCategory } from "@/lib/categories";
import {
  displayNameFromIdentity,
  privateHeaders,
  requireIdentity,
} from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type DeedRow = {
  id: string | number;
  title: string;
  category: string;
  points: number;
  created_at: string | Date;
};

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const rows = await sql<DeedRow>(
    `select id, title, category, points, created_at
     from deeds
     where user_id = $1
     order by created_at desc
     limit 50`,
    [identity.sub],
  );

  return Response.json(
    {
      deeds: rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        category: row.category,
        points: row.points,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    },
    { headers: privateHeaders },
  );
}

export async function POST(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;
  if (identity.kind === "key") {
    return Response.json(
      { error: "Ключ не может добавлять дела" },
      { status: 403, headers: privateHeaders },
    );
  }

  let body: { title?: unknown; category?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Некорректный запрос" },
      { status: 400, headers: privateHeaders },
    );
  }

  const title =
    typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
  const categoryId =
    typeof body.category === "string" ? body.category.trim() : "";
  const category = getCategory(categoryId);

  if (title.length < 3) {
    return Response.json(
      { error: "Опиши дело чуть подробнее" },
      { status: 400, headers: privateHeaders },
    );
  }
  if (!category) {
    return Response.json(
      { error: "Выбери категорию" },
      { status: 400, headers: privateHeaders },
    );
  }

  const name = displayNameFromIdentity(identity);
  await sql(
    `insert into profiles (user_id, display_name)
     values ($1, $2)
     on conflict (user_id) do update
       set display_name = excluded.display_name,
           updated_at = now()`,
    [identity.sub, name],
  );

  const [row] = await sql<DeedRow>(
    `insert into deeds (user_id, title, category, points)
     values ($1, $2, $3, $4)
     returning id, title, category, points, created_at`,
    [identity.sub, title, category.id, category.points],
  );

  return Response.json(
    {
      deed: {
        id: Number(row.id),
        title: row.title,
        category: row.category,
        points: row.points,
        createdAt: new Date(row.created_at).toISOString(),
      },
    },
    { status: 201, headers: privateHeaders },
  );
}
