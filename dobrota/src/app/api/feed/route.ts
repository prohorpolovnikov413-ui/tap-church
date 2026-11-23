import { privateHeaders, requireIdentity } from "@/lib/auth";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type FeedRow = {
  id: string | number;
  title: string;
  category: string;
  points: number;
  created_at: string | Date;
  photo_data: string | null;
  display_name: string;
  user_id: string;
};

export async function GET(request: Request) {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;

  const rows = await sql<FeedRow>(
    `select
       d.id,
       d.title,
       d.category,
       d.points,
       d.created_at,
       d.photo_data,
       p.display_name,
       d.user_id
     from deeds d
     join profiles p on p.user_id = d.user_id
     where d.photo_data is not null
     order by d.created_at desc
     limit 24`,
  );

  return Response.json(
    {
      items: rows.map((row) => ({
        id: Number(row.id),
        title: row.title,
        category: row.category,
        points: row.points,
        createdAt: new Date(row.created_at).toISOString(),
        photoUrl: row.photo_data,
        authorName: row.display_name,
        isYou: row.user_id === identity.sub,
      })),
    },
    { headers: privateHeaders },
  );
}
