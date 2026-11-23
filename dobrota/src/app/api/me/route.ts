import { displayNameFromIdentity, privateHeaders, requireIdentity } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const name = displayNameFromIdentity(identity);
  await sql(
    `insert into profiles (user_id, display_name)
     values ($1, $2)
     on conflict (user_id) do update
       set display_name = excluded.display_name,
           updated_at = now()`,
    [identity.sub, name],
  );

  const [stats] = await sql<{
    total_points: string | number;
    deed_count: string | number;
  }>(
    `select
       coalesce(sum(points), 0) as total_points,
       count(*)::int as deed_count
     from deeds
     where user_id = $1`,
    [identity.sub],
  );

  return Response.json(
    {
      name,
      totalPoints: Number(stats?.total_points ?? 0),
      deedCount: Number(stats?.deed_count ?? 0),
      simulated: identity.simulated === true,
    },
    { headers: privateHeaders },
  );
}

export async function PATCH(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;
  if (identity.kind === "key") {
    return Response.json(
      { error: "Ключ не может менять имя" },
      { status: 403, headers: privateHeaders },
    );
  }

  let body: { name?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Некорректный запрос" },
      { status: 400, headers: privateHeaders },
    );
  }

  const name =
    typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (name.length < 2) {
    return Response.json(
      { error: "Имя должно быть не короче 2 символов" },
      { status: 400, headers: privateHeaders },
    );
  }

  await sql(
    `insert into profiles (user_id, display_name)
     values ($1, $2)
     on conflict (user_id) do update
       set display_name = excluded.display_name,
           updated_at = now()`,
    [identity.sub, name],
  );

  return Response.json({ name }, { headers: privateHeaders });
}
