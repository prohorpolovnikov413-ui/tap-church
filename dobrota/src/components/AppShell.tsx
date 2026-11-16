"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CATEGORIES, type CategoryId } from "@/lib/categories";

type Me = {
  name: string;
  totalPoints: number;
  deedCount: number;
  simulated?: boolean;
};

type Deed = {
  id: number;
  title: string;
  category: string;
  points: number;
  createdAt: string;
};

type BoardEntry = {
  rank: number;
  name: string;
  totalPoints: number;
  deedCount: number;
  isYou: boolean;
};

const categoryLabel = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label]),
) as Record<string, string>;

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}

function deedsWord(count: number) {
  const n = Math.abs(count) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return "дел";
  if (n1 === 1) return "дело";
  if (n1 >= 2 && n1 <= 4) return "дела";
  return "дел";
}

export function AppShell() {
  const [me, setMe] = useState<Me | null>(null);
  const [deeds, setDeeds] = useState<Deed[]>([]);
  const [board, setBoard] = useState<BoardEntry[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CategoryId>("help");
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setError(null);
    const [meRes, deedsRes, boardRes] = await Promise.all([
      fetch("/api/me", { cache: "no-store" }),
      fetch("/api/deeds", { cache: "no-store" }),
      fetch("/api/leaderboard", { cache: "no-store" }),
    ]);

    if (!meRes.ok) {
      throw new Error("Не удалось войти. Открой приложение как private или team.");
    }

    const meJson = (await meRes.json()) as Me;
    const deedsJson = (await deedsRes.json()) as { deeds: Deed[] };
    const boardJson = (await boardRes.json()) as { entries: BoardEntry[] };

    setMe(meJson);
    setNameDraft(meJson.name);
    setDeeds(deedsJson.deeds ?? []);
    setBoard(boardJson.entries ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadAll();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  async function onAddDeed(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      const res = await fetch("/api/deeds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, category }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Не удалось сохранить");
      }
      setTitle("");
      setFlash(`+${data.deed.points} баллов за доброе дело`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function onSaveName(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nameDraft }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Не удалось сохранить имя");
      }
      setFlash("Имя в рейтинге обновлено");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const selected = CATEGORIES.find((c) => c.id === category)!;

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <header className="relative isolate min-h-[100svh] px-5 pb-16 pt-8 sm:px-8 lg:px-12">
        <div className="meadow" aria-hidden>
          <div className="meadow__sun" />
          <div className="meadow__hill meadow__hill--back" />
          <div className="meadow__hill meadow__hill--front" />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-4rem)] max-w-5xl flex-col justify-end gap-10 pb-6 pt-16 sm:justify-center sm:pb-10">
          <div className="max-w-2xl">
            <p
              className="reveal font-[family-name:var(--font-display)] text-5xl font-semibold tracking-tight text-[var(--ink)] sm:text-7xl md:text-8xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Доброта
            </p>
            <h1
              className="reveal reveal-delay-1 mt-5 max-w-xl text-2xl font-medium leading-snug text-[var(--ink)] sm:text-3xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Делай доброе дело — отмечай его — поднимайся в рейтинге
            </h1>
            <p className="reveal reveal-delay-2 mt-4 max-w-md text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
              Здесь каждое доброе действие превращается в баллы, а таблица
              показывает, кто сегодня делает мир теплее.
            </p>
            <div className="reveal reveal-delay-3 mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#add"
                className="inline-flex items-center justify-center rounded-full bg-[var(--leaf-deep)] px-6 py-3 text-sm font-semibold text-[var(--foam)] transition hover:bg-[var(--leaf)]"
              >
                Отметить доброе дело
              </a>
              <a
                href="#board"
                className="inline-flex items-center justify-center rounded-full border border-[var(--line)] bg-[var(--mist)] px-6 py-3 text-sm font-semibold text-[var(--ink)] backdrop-blur-sm transition hover:bg-white/70"
              >
                Смотреть рейтинг
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-5xl space-y-20 px-5 pb-24 sm:px-8 lg:px-12">
        {me?.simulated ? (
          <p className="rounded-2xl border border-[var(--line)] bg-white/50 px-4 py-3 text-sm text-[var(--ink-soft)] backdrop-blur">
            Локально ты видишь тестового участника. В опубликованном приложении
            (private или team) будет твоё имя из Cursor.
          </p>
        ) : null}

        {loading ? (
          <p className="text-[var(--ink-soft)]">Загружаем…</p>
        ) : null}
        {error ? (
          <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </p>
        ) : null}
        {flash ? (
          <p className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {flash}
          </p>
        ) : null}

        <section id="add" className="scroll-mt-10">
          <p
            className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--leaf)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Новая запись
          </p>
          <h2
            className="mt-2 text-3xl font-semibold text-[var(--ink)] sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Что хорошего ты сделал?
          </h2>
          <p className="mt-3 max-w-xl text-[var(--ink-soft)]">
            Коротко опиши дело и выбери, насколько оно было значимым — от этого
            зависят баллы.
          </p>

          <form
            onSubmit={onAddDeed}
            className="mt-8 space-y-6 border-t border-[var(--line)] pt-8"
          >
            <label className="block">
              <span className="mb-2 block text-sm font-medium text-[var(--ink)]">
                Описание
              </span>
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                rows={3}
                maxLength={160}
                required
                placeholder="Например: помог соседке донести сумки до двери"
                className="w-full resize-y rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none ring-[var(--leaf)] transition focus:ring-2"
              />
            </label>

            <fieldset>
              <legend className="mb-3 text-sm font-medium text-[var(--ink)]">
                Категория и баллы
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {CATEGORIES.map((item) => {
                  const active = item.id === category;
                  return (
                    <label
                      key={item.id}
                      className={`cursor-pointer rounded-2xl border px-4 py-3 transition ${
                        active
                          ? "border-[var(--leaf-deep)] bg-[var(--leaf)]/15 shadow-[inset_0_0_0_1px_var(--leaf-deep)]"
                          : "border-[var(--line)] bg-white/50 hover:bg-white/80"
                      }`}
                    >
                      <input
                        type="radio"
                        name="category"
                        value={item.id}
                        checked={active}
                        onChange={() => setCategory(item.id)}
                        className="sr-only"
                      />
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-[var(--ink)]">
                          {item.label}
                        </span>
                        <span className="text-sm font-semibold text-[var(--leaf-deep)]">
                          +{item.points}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--ink-soft)]">
                        {item.hint}
                      </p>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-[var(--leaf-deep)] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[var(--leaf)] disabled:opacity-60"
              >
                {busy ? "Сохраняем…" : `Добавить · +${selected.points}`}
              </button>
              {me ? (
                <p className="text-sm text-[var(--ink-soft)]">
                  У тебя сейчас{" "}
                  <strong className="text-[var(--ink)]">{me.totalPoints}</strong>{" "}
                  баллов и{" "}
                  <strong className="text-[var(--ink)]">{me.deedCount}</strong>{" "}
                  {deedsWord(me.deedCount)}
                </p>
              ) : null}
            </div>
          </form>
        </section>

        <section id="board" className="scroll-mt-10">
          <p
            className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--leaf)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Рейтинг
          </p>
          <h2
            className="mt-2 text-3xl font-semibold text-[var(--ink)] sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Кто поднимается выше
          </h2>
          <p className="mt-3 max-w-xl text-[var(--ink-soft)]">
            Чем больше добрых дел и баллов — тем выше место в таблице.
          </p>

          <form
            onSubmit={onSaveName}
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <label className="block flex-1">
              <span className="mb-2 block text-sm font-medium">
                Имя в рейтинге
              </span>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={40}
                className="w-full rounded-2xl border border-[var(--line)] bg-white/70 px-4 py-3 outline-none ring-[var(--leaf)] focus:ring-2"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="rounded-full border border-[var(--line)] bg-white/70 px-5 py-3 text-sm font-semibold hover:bg-white disabled:opacity-60"
            >
              Сохранить имя
            </button>
          </form>

          <ol className="mt-8 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {board.length === 0 ? (
              <li className="py-8 text-[var(--ink-soft)]">
                Пока пусто — будь первым, кто отметит доброе дело.
              </li>
            ) : (
              board.map((entry) => (
                <li
                  key={`${entry.rank}-${entry.name}`}
                  className={`deed-row flex items-center gap-4 py-4 ${
                    entry.isYou ? "bg-[var(--leaf)]/8" : ""
                  }`}
                >
                  <span
                    className="w-10 shrink-0 text-2xl font-semibold text-[var(--leaf-deep)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {entry.rank}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-[var(--ink)]">
                      {entry.name}
                      {entry.isYou ? (
                        <span className="ml-2 text-sm font-medium text-[var(--leaf)]">
                          это ты
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-[var(--ink-soft)]">
                      {entry.deedCount} {deedsWord(entry.deedCount)}
                    </p>
                  </div>
                  <span
                    className="shrink-0 text-xl font-semibold text-[var(--ink)]"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {entry.totalPoints}
                  </span>
                </li>
              ))
            )}
          </ol>
        </section>

        <section id="history" className="scroll-mt-10">
          <p
            className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--leaf)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Твои дела
          </p>
          <h2
            className="mt-2 text-3xl font-semibold text-[var(--ink)] sm:text-4xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            История доброты
          </h2>
          <p className="mt-3 max-w-xl text-[var(--ink-soft)]">
            Все добрые дела, которые ты уже отметил.
          </p>

          <ul className="mt-8 space-y-0 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {deeds.length === 0 ? (
              <li className="py-8 text-[var(--ink-soft)]">
                Записей ещё нет — добавь первое дело выше.
              </li>
            ) : (
              deeds.map((deed) => (
                <li key={deed.id} className="deed-row flex gap-4 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-[var(--ink)]">{deed.title}</p>
                    <p className="mt-1 text-sm text-[var(--ink-soft)]">
                      {categoryLabel[deed.category] ?? deed.category} ·{" "}
                      {formatDate(deed.createdAt)}
                    </p>
                  </div>
                  <span className="shrink-0 font-semibold text-[var(--leaf-deep)]">
                    +{deed.points}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>

      <footer className="border-t border-[var(--line)] px-5 py-8 text-center text-sm text-[var(--ink-soft)] sm:px-8">
        Доброта — маленькие шаги, которые складываются в большую таблицу тепла.
      </footer>
    </div>
  );
}
