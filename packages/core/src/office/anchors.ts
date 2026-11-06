import {
  OBJECT_SPECS,
  findRoomAt,
  localToWorld,
  roomCenter,
  type OfficeLayout,
  type SeatKind,
  type Vec2,
} from './layout';

/** Ponto onde um avatar pode ficar (sentado ou em pé), com orientação. */
export interface Anchor {
  key: string;
  roomKey: string;
  kind: SeatKind | 'stand';
  position: Vec2;
  facing: number;
  seatHeight: number;
}

const SEAT_KIND_BY_TYPE: Partial<Record<string, SeatKind>> = {
  office_chair: 'desk',
  meeting_chair: 'meeting',
  sofa: 'lounge',
  armchair: 'lounge',
};

/** Extrai todos os assentos do layout. Chave: `objKey` ou `objKey#i` para objetos com vários assentos. */
export function getSeatAnchors(layout: OfficeLayout): Anchor[] {
  const anchors: Anchor[] = [];
  for (const obj of layout.objects) {
    const spec = OBJECT_SPECS[obj.type];
    if (!spec.seats) continue;
    const kind = (obj.props?.seatKind as SeatKind | undefined) ?? SEAT_KIND_BY_TYPE[obj.type] ?? 'guest';
    spec.seats.forEach((seat, i) => {
      anchors.push({
        key: spec.seats!.length > 1 ? `${obj.key}#${i}` : obj.key,
        roomKey: obj.roomKey,
        kind,
        position: localToWorld(obj, seat.offset),
        facing: obj.rotation,
        seatHeight: seat.height,
      });
    });
  }
  return anchors;
}

/** Ponto de entrada do prédio (porta externa da recepção), usado ao entrar/sair do expediente. */
export function getEntranceAnchor(layout: OfficeLayout): Anchor {
  for (const room of layout.rooms) {
    const door = room.doors.find((d) => d.exterior);
    if (!door) continue;
    const { x, z, w, d } = room.bounds;
    const mid = door.offset + door.width / 2;
    const inset = 0.8;
    const map: Record<string, { p: Vec2; facing: number }> = {
      s: { p: [x + mid, z + d - inset], facing: 0 },
      n: { p: [x + mid, z + inset], facing: Math.PI },
      e: { p: [x + w - inset, z + mid], facing: Math.PI / 2 },
      w: { p: [x + inset, z + mid], facing: -Math.PI / 2 },
    };
    const m = map[door.side]!;
    return { key: 'entrance', roomKey: room.key, kind: 'stand', position: m.p, facing: m.facing, seatHeight: 0 };
  }
  const first = layout.rooms[0]!;
  return {
    key: 'entrance',
    roomKey: first.key,
    kind: 'stand',
    position: roomCenter(first),
    facing: 0,
    seatHeight: 0,
  };
}

/** Posições em pé ao redor do centro de uma sala (fallback quando faltam assentos). */
export function standingAnchor(layout: OfficeLayout, roomKey: string, index: number): Anchor {
  const room = layout.rooms.find((r) => r.key === roomKey) ?? layout.rooms[0]!;
  const [cx, cz] = roomCenter(room);
  const ring = Math.min(room.bounds.w, room.bounds.d) / 2 - 0.9;
  const angle = (index * 2 * Math.PI) / 8;
  const p: Vec2 = [cx + Math.sin(angle) * ring, cz + Math.cos(angle) * ring];
  return {
    key: `${roomKey}:stand:${index}`,
    roomKey: findRoomAt(layout, p)?.key ?? roomKey,
    kind: 'stand',
    position: p,
    facing: Math.atan2(cx - p[0], cz - p[1]),
    seatHeight: 0,
  };
}
