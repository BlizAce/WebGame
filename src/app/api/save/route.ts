import { NextResponse } from "next/server";
import {
  clearSave,
  getSaveJson,
  putSaveJson,
} from "@/lib/server/sqliteSave";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const json = getSaveJson();
  if (!json) {
    return NextResponse.json({ error: "No save" }, { status: 404 });
  }
  return new NextResponse(json, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export async function PUT(req: Request) {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!text?.trim()) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  try {
    const save = putSaveJson(text);
    return NextResponse.json({
      ok: true,
      schemaVersion: save.schemaVersion,
      realms: save.realms.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Save failed" },
      { status: 400 },
    );
  }
}

export async function DELETE() {
  clearSave();
  return NextResponse.json({ ok: true });
}
