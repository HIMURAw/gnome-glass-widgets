import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, hhmm, label, paragraph, spacer} from '../ui.js';

function format(date, pattern) {
    return GLib.DateTime.new_from_unix_local(Math.floor(date / 1000)).format(pattern);
}

function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "14:00", or "Tomorrow 09:30", or the weekday for later ones.
function when(event, now) {
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    let day = '';
    if (!sameDay(event.date, now))
        day = sameDay(event.date, tomorrow) ? _('Tomorrow') : format(event.date, '%a %-d');
    if (event.allDay)
        return day || _('All day');
    return day ? `${day} ${hhmm(event.date)}` : hhmm(event.date);
}

// Monday first, as in Turkey and most of Europe (GNOME's own setting is not exposed).
function monthGrid(now, hasEvents, big) {
    const grid = new St.Widget({layout_manager: new Clutter.GridLayout({column_homogeneous: true}),
        style_class: big ? 'gwidgets-month gwidgets-month-big' : 'gwidgets-month', x_expand: true});
    const layout = grid.layout_manager;
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 7; i++) {
        const d = new Date(2024, 0, 1 + i); // a Monday
        layout.attach(label(format(d, '%a').slice(0, big ? 3 : 1), 'gwidgets-month-head',
            {x_align: Clutter.ActorAlign.CENTER}), i, 0, 1, 1);
    }
    const offset = (first.getDay() + 6) % 7;
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    for (let n = 1; n <= days; n++) {
        const date = new Date(now.getFullYear(), now.getMonth(), n);
        const cell = box(true, 'gwidgets-month-cell', {x_align: Clutter.ActorAlign.CENTER});
        const today = n === now.getDate();
        const weekend = date.getDay() === 0 || date.getDay() === 6;
        cell.add_child(label(String(n), `gwidgets-month-day${today ? ' gwidgets-today' : ''}${weekend ? ' gwidgets-weekend' : ''}`,
            {x_align: Clutter.ActorAlign.CENTER}));
        cell.add_child(new St.Widget({style_class: hasEvents?.(date) && !today ? 'gwidgets-event-dot' : 'gwidgets-event-dot gwidgets-hidden',
            x_align: Clutter.ActorAlign.CENTER}));
        const slot = offset + n - 1;
        layout.attach(cell, slot % 7, 1 + Math.floor(slot / 7), 1, 1);
    }
    return grid;
}

function eventRow(event, now) {
    const row = box(false, 'gwidgets-event');
    row.add_child(new St.Widget({style_class: 'gwidgets-event-bar'}));
    const text = box(true, '', {x_expand: true});
    text.add_child(label(event.summary, 'gwidgets-event-title'));
    text.add_child(label(when(event, now), 'gwidgets-dim'));
    row.add_child(text);
    return row;
}

export class CalendarWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this.target = {app: 'org.gnome.Calendar.desktop'};
        let data = null;
        let day = -1;
        const render = () => {
            const now = new Date();
            day = now.getDate();
            if (size === 'small')
                this._small(now, data);
            else if (size === 'medium')
                this._medium(now, data);
            else
                this._large(now, data);
        };
        this.watch(ctx.sources.calendar, value => {
            data = value;
            render();
        });
        this.watch(ctx.sources.clock, now => {
            if (now.getDate() !== day)
                render();
        });
    }

    _today(now, data, events) {
        const col = box(true, 'gwidgets-cal-today', {x_expand: true, y_expand: true});
        col.add_child(label(format(now, '%A').toLocaleUpperCase(), 'gwidgets-caption gwidgets-red'));
        col.add_child(label(String(now.getDate()), 'gwidgets-cal-number'));
        col.add_child(spacer());
        const upcoming = data?.upcoming ?? [];
        if (!upcoming.length) {
            col.add_child(label(data?.hasCalendars === false ? _('No calendars') : _('No events'), 'gwidgets-dim'));
        } else {
            upcoming.slice(0, events).forEach(e => {
                col.add_child(paragraph(e.summary, 'gwidgets-event-title', 40));
                col.add_child(label(when(e, now), 'gwidgets-dim'));
            });
        }
        return col;
    }

    _small(now, data) {
        this.fill(this._today(now, data, 1));
    }

    _medium(now, data) {
        const row = box(false, 'gwidgets-cal-row', {x_expand: true, y_expand: true});
        row.add_child(this._today(now, data, 1));
        const right = box(true, '', {x_expand: true});
        right.add_child(label(format(now, '%B').toLocaleUpperCase(), 'gwidgets-caption gwidgets-red'));
        right.add_child(monthGrid(now, data?.hasEvents, false));
        row.add_child(right);
        this.fill(row);
    }

    _large(now, data) {
        const top = box(false, 'gwidgets-header');
        top.add_child(label(format(now, '%B %Y'), 'gwidgets-cal-month', {x_expand: true}));
        top.add_child(label(format(now, '%A %-d'), 'gwidgets-caption gwidgets-red', {y_align: Clutter.ActorAlign.CENTER}));
        const list = box(true, 'gwidgets-event-list', {x_expand: true, y_expand: true});
        const upcoming = data?.upcoming ?? [];
        if (!upcoming.length)
            list.add_child(label(data?.hasCalendars === false ? _('No calendars') : _('No upcoming events'), 'gwidgets-dim'));
        upcoming.slice(0, 3).forEach(e => list.add_child(eventRow(e, now)));
        this.fill(top, monthGrid(now, data?.hasEvents, true), list);
    }
}
