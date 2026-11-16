import { privateHeaders, requireIdentity } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type BoardRow = {
  user_id: string;
  display_name: string;
  total_points: string | number;
  deed_count: string | number;
};

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const rows = await sql<BoardRow>(
    `select
       p.user_id,
       p.display_name,
       coalesce(sum(d.points), 0) as total_points,
       count(d.id)::int as deed_count
     from profiles p
     left join deeds d on d.user_id = p.user_id
     group by p.user_id, p.display_name
     having count(d.id) > 0
     order by coalesce(sum(d.points), 0) desc, count(d.id) desc, p.display_name asc
     limit 30`,
  );

  return Response.json(
    {
      entries: rows.map((row, index) => ({
        rank: index + 1,
        name: row.display_name,
        totalPoints: Number(row.total_points),
        deedCount: Number(row.deed_count),
        isYou: row.user_id === identity.sub,
      })),
    },
    { headers: privateHeaders },
  );
}
