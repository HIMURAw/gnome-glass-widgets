import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, hhmm, label, money, paintBar, paragraph, placeholder, spacer} from '../ui.js';

// Widgets fed by Harvis, the personal assistant (`harvis widgets`): its reminders, the
// morning report and the money. Green is Harvis's colour (its brain on the island).

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

class HarvisWidget extends Widget {
    constructor(ctx, size, key) {
        super(ctx, size);
        this.watch(ctx.sources.harvis, data => {
            const part = data?.[key];
            if (!data)
                this.fill(this.head(), placeholder(_('Harvis is not available')));
            else if (!part || part.error)
                this.fill(this.head(), placeholder(_('Could not read it')));
            else
                this.render(part);
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

export class FinanceWidget extends HarvisWidget {
    constructor(ctx, size) {
        super(ctx, size, 'finance');
    }

    head() {
        return this.header(_('Money'), 'gwidgets-green');
    }

    render(f) {
        const total = box(true, 'gwidgets-finance-total');
        total.add_child(label(_('Total'), 'gwidgets-dim'));
        total.add_child(label(money(f.total), 'gwidgets-finance-big'));
        const month = box(false, 'gwidgets-finance-month');
        month.add_child(label(`↑ ${money(f.month.earned)}`, 'gwidgets-finance-in'));
        month.add_child(label(`↓ ${money(f.month.spent)}`, 'gwidgets-finance-out'));
        const left = box(true, '', {x_expand: true});
        left.add_child(total);
        left.add_child(spacer());
        left.add_child(label(_('This month'), 'gwidgets-dim gwidgets-tiny'));
        left.add_child(month);
        if (this.size === 'small') {
            this.fill(this.head(), left);
            return;
        }
        const right = box(true, 'gwidgets-finance-right', {x_expand: true});
        f.balances.slice(0, 3).forEach(b => {
            const row = box(false, 'gwidgets-finance-row');
            row.add_child(label(b.name.replace(/\s*\(.*\)$/, ''), 'gwidgets-finance-name', {x_expand: true}));
            row.add_child(label(money(b.amount), 'gwidgets-finance-amount'));
            right.add_child(row);
        });
        if (f.goal?.amount) {
            right.add_child(spacer());
            const part = Math.min(1, (f.total ?? 0) / f.goal.amount);
            const goal = box(false);
            goal.add_child(label(f.goal.name.replace(/\s*[—(].*$/, ''), 'gwidgets-dim gwidgets-tiny', {x_expand: true}));
            goal.add_child(label(`%${Math.round(part * 100)}`, 'gwidgets-dim gwidgets-tiny'));
            right.add_child(goal);
            right.add_child(drawingArea(Math.round(this.width / 2) - 24, 5, (cr, w, h) => paintBar(cr, w, h, part, [0.2, 0.84, 0.35])));
        }
        const row = box(false, 'gwidgets-finance-cols', {x_expand: true, y_expand: true});
        row.add_child(left);
        row.add_child(right);
        this.fill(this.head(), row);
    }
}
