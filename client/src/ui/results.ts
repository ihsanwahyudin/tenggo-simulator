import type { RoomMsg } from '@tenggo/shared';
import { playerRow } from './lobby';

const $ = (id: string) => document.getElementById(id)!;

export class ResultsUI {
  private panel = $('results');

  constructor(onAgain: () => void) {
    $('again').addEventListener('click', onAgain);
  }

  show(room: RoomMsg, myId: number): void {
    this.panel.hidden = false;
    $('ranking').replaceChildren(
      ...(room.results ?? []).map((r) => {
        const li = playerRow(r.name, r.color, r.rank ? `${r.time.toFixed(2)} dtk` : 'Lembur (tidak finis)');
        const place = document.createElement('span');
        place.className = 'place';
        place.textContent = r.rank ? `#${r.rank}` : '—';
        li.prepend(place);
        if (r.id === myId) li.classList.add('me');
        return li;
      }),
    );
    const isHost = room.host === myId;
    $('again').hidden = !isHost;
    $('results-hint').textContent = isHost ? '' : 'Menunggu host untuk main lagi…';
  }

  hide(): void {
    this.panel.hidden = true;
  }
}
