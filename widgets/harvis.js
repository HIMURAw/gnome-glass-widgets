import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, hhmm, label, money, paintLine, paragraph, placeholder, spacer} from '../ui.js';

// Widgets fed by Harvis, the personal assistant (`harvis widgets`): its reminders, the
// morning report and the markets. Green is Harvis's colour (its brain on the island).

function reminderWhen(at) {
    const date = new Date(at);
    const now = new Date();
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diff = Math.round((day - today) / 86400000);
    if (diff === 0)
        return _('Today %s').format(hhmm(date));
    if (diff === 1)
        return _('Tomorrow %s').format(hhmm(date));
    return `${date.toLocaleDateString(undefined, {day: 'numeric', month: 'short'})} ${hhmm(date)}`;
}

export class HarvisWidget extends Widget {
    constructor(ctx, size, key) {
        super(ctx, size);
        this.watch(ctx.sources.harvis, data => {
            const part = data?.[key];
            if (!data)
                this.fill(this.head(), placeholder(_('Harvis is not available')));
            else if (!part || part.error)
                this.fill(this.head(), placeholder(_('Could not read it')));
            else {
                this.target = part.open ?? null;
                this.render(part);
            }
        });
    }
}

export class RemindersWidget extends HarvisWidget {
    constructor(ctx, size) {
        super(ctx, size, 'reminders');
    }

    head() {
        return this.header(_('Reminders'), 'gwidgets-green');
    }

    render(items) {
        if (!items.length) {
            const empty = box(true, '', {x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
            empty.add_child(paragraph(_('Nothing to remember'), 'gwidgets-placeholder', 40, {x_align: Clutter.ActorAlign.CENTER}));
            empty.add_child(paragraph(_('“Hey Harvis, remind me at nine tomorrow…”'), 'gwidgets-dim gwidgets-tiny gwidgets-center', 60,
                {x_align: Clutter.ActorAlign.CENTER}));
            this.fill(this.head(), empty);
            return;
        }
        const list = box(true, 'gwidgets-reminder-list', {x_expand: true, y_expand: true});
        items.slice(0, this.size === 'small' ? 2 : 4).forEach(r => {
            const row = box(false, 'gwidgets-reminder');
            row.add_child(new St.Widget({style_class: 'gwidgets-reminder-ring', y_align: Clutter.ActorAlign.START}));
            const col = box(true, '', {x_expand: true});
            col.add_child(paragraph(r.text, 'gwidgets-reminder-text', this.size === 'small' ? 36 : 60));
            col.add_child(label(reminderWhen(r.at), 'gwidgets-dim gwidgets-tiny'));
            row.add_child(col);
            list.add_child(row);
        });
        this.fill(this.head(), list);
    }
}

export class MorningWidget extends HarvisWidget {
    constructor(ctx, size) {
        super(ctx, size, 'morning');
    }

    head(date = '') {
        return this.header(_('Morning report'), 'gwidgets-green', date ? label(date, 'gwidgets-dim') : null);
    }

    render(m) {
        if (!m.today?.length && !m.yesterday?.length) {
            this.fill(this.head(), placeholder(_('No report yet today')));
            return;
        }
        const big = this.size === 'large';
        const section = (title, items, numbered, limit) => {
            const col = box(true, 'gwidgets-morning-section');
            col.add_child(label(title, 'gwidgets-morning-title'));
            items.slice(0, limit).forEach((text, i) => {
                const row = box(false, 'gwidgets-morning-row');
                row.add_child(label(numbered ? `${i + 1}` : '•', `gwidgets-morning-mark${numbered ? ' gwidgets-morning-num' : ''}`));
                row.add_child(paragraph(text, 'gwidgets-morning-text', big ? 80 : 46, {x_expand: true}));
                col.add_child(row);
            });
            return col;
        };
        const parts = [this.head(m.date)];
        if (m.today?.length)
            parts.push(section(_('Today'), m.today, true, big ? 4 : 3));
        if (big && m.yesterday?.length)
            parts.push(section(_('Yesterday'), m.yesterday, false, 4));
        if (big && m.mail) {
            parts.push(spacer());
            parts.push(label(`✉  ${m.mail}`, 'gwidgets-dim gwidgets-tiny'));
        }
        this.fill(...parts);
    }
}

// Prices in the way they are read: lira without kuruş once they are big, dollars with $.
function price(value, currency) {
    if (value === null || value === undefined)
        return '—';
    const digits = Math.abs(value) >= 1000 ? 0 : 2;
    const text = value.toLocaleString('tr-TR', {minimumFractionDigits: digits, maximumFractionDigits: digits});
    return currency === 'USD' ? `$${text}` : `${text} ₺`;
}

function change(pct) {
    const flat = Math.abs(pct) < 0.05;
    const shown = flat ? 0 : pct;
    const text = `${shown > 0 ? '+' : ''}${shown.toLocaleString('tr-TR', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`;
    return label(text, pct > 0.05 ? 'gwidgets-market-up' : pct < -0.05 ? 'gwidgets-market-down' : 'gwidgets-market-flat');
}

const UP = [0.19, 0.82, 0.35];
const DOWN = [1, 0.41, 0.38];

// Gold, what you own and what you watch: the price, today's change and the month's line.
export class MarketsWidget extends HarvisWidget {
    constructor(ctx, size) {
        super(ctx, size, 'markets');
    }

    head() {
        return this.header(_('Investments'), 'gwidgets-orange');
    }

    _line(item, w, h) {
        const color = item.line.at(-1) >= item.line[0] ? UP : DOWN;
        return drawingArea(w, h, (cr, ww, hh) => paintLine(cr, ww, hh, item.line, color), {y_align: Clutter.ActorAlign.CENTER});
    }

    render(m) {
        const items = m.items ?? [];
        if (!items.length) {
            this.fill(this.head(), placeholder(_('Nothing to show yet')));
            return;
        }
        const footer = label(_('%s · 15 min delay').format(hhmm(new Date(m.at * 1000))), 'gwidgets-dim gwidgets-tiny');
        if (this.size === 'small') {
            const top = items.find(i => i.line) ?? items[0];
            const col = box(true, 'gwidgets-market-hero', {x_expand: true, y_expand: true});
            col.add_child(label(top.name, 'gwidgets-dim'));
            col.add_child(label(price(top.price, top.currency), 'gwidgets-market-big'));
            if (top.line) {
                col.add_child(change(top.change));
                col.add_child(spacer());
                col.add_child(this._line(top, this.width - 32, 30));
            }
            this.fill(this.head(), col);
            return;
        }
        const list = box(true, 'gwidgets-market-list', {x_expand: true, y_expand: true});
        const wide = this.size === 'large';
        items.slice(0, wide ? 7 : 3).forEach(item => {
            const row = box(false, 'gwidgets-market-row', {x_expand: true});
            const name = box(false, 'gwidgets-market-name-box', {x_expand: true});
            name.add_child(label(item.owned ? '●' : '', 'gwidgets-market-owned', {y_align: Clutter.ActorAlign.CENTER}));
            name.add_child(label(item.name, 'gwidgets-market-name', {y_align: Clutter.ActorAlign.CENTER}));
            row.add_child(name);
            if (item.line) {
                row.add_child(this._line(item, wide ? 90 : 56, 18));
                const right = box(true, 'gwidgets-market-right');
                right.add_child(label(price(item.price, item.currency), 'gwidgets-market-price', {x_align: Clutter.ActorAlign.END}));
                const ch = change(item.change);
                ch.x_align = Clutter.ActorAlign.END;
                right.add_child(ch);
                row.add_child(right);
            } else {
                // A holding with no market price here (a fund): what it cost.
                const right = box(true, 'gwidgets-market-right');
                right.add_child(label(money(item.cost), 'gwidgets-market-price', {x_align: Clutter.ActorAlign.END}));
                right.add_child(label(_('cost'), 'gwidgets-dim gwidgets-tiny', {x_align: Clutter.ActorAlign.END}));
                row.add_child(right);
            }
            list.add_child(row);
        });
        if (wide)
            this.fill(this.head(), list, footer);
        else
            this.fill(this.head(), list);
    }
}
