import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Cairo from 'cairo';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, drawingArea, label, paintBar, spacer} from '../ui.js';

const ORANGE = [1.0, 0.62, 0.04];

function format(date, pattern) {
    return GLib.DateTime.new_from_unix_local(Math.floor(date / 1000)).format(pattern);
}

// A watch face: twelve marks, hour and minute hands, an orange seconds hand and a
// date window at three o'clock, the way a wristwatch shows it.
function paintFace(cr, w, h, s, now) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) / 2 - 2 * s;
    cr.setLineCap(Cairo.LineCap.ROUND);
    for (let i = 0; i < 60; i++) {
        const a = (i / 60) * 2 * Math.PI;
        const hour = i % 5 === 0;
        const inner = r * (hour ? 0.84 : 0.9);
        cr.setSourceRGBA(1, 1, 1, hour ? 0.9 : 0.28);
        cr.setLineWidth((hour ? 2.4 : 1) * s);
        cr.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
        cr.lineTo(cx + Math.sin(a) * r * 0.96, cy - Math.cos(a) * r * 0.96);
        cr.stroke();
    }
    // The date window.
    const day = String(now.getDate());
    cr.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD);
    cr.setFontSize(11 * s);
    const ext = cr.textExtents(day);
    const bx = cx + r * 0.42;
    cr.setSourceRGBA(1, 1, 1, 0.1);
    cr.rectangle(bx - 3 * s, cy - 8 * s, ext.width + 6 * s + ext.xBearing, 16 * s);
    cr.fill();
    cr.setSourceRGBA(...ORANGE, 1);
    cr.moveTo(bx, cy + ext.height / 2);
    cr.showText(day);

    const sec = now.getSeconds();
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;
    const hand = (angle, length, width, color, tail = 0) => {
        cr.setSourceRGBA(...color);
        cr.setLineWidth(width * s);
        cr.moveTo(cx - Math.sin(angle) * tail, cy + Math.cos(angle) * tail);
        cr.lineTo(cx + Math.sin(angle) * length, cy - Math.cos(angle) * length);
        cr.stroke();
    };
    hand((hr / 12) * 2 * Math.PI, r * 0.5, 4.5, [1, 1, 1, 1]);
    hand((min / 60) * 2 * Math.PI, r * 0.74, 3.2, [1, 1, 1, 1]);
    hand((sec / 60) * 2 * Math.PI, r * 0.84, 1.3, [...ORANGE, 1], r * 0.16);
    cr.setSourceRGBA(...ORANGE, 1);
    cr.arc(cx, cy, 3.2 * s, 0, 2 * Math.PI);
    cr.fill();
    cr.setSourceRGBA(0.1, 0.1, 0.1, 1);
    cr.arc(cx, cy, 1.2 * s, 0, 2 * Math.PI);
    cr.fill();
}

export class ClockWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        if (size === 'small')
            this._analog();
        else
            this._digital();
    }

    _analog() {
        this.body.add_style_class_name('gwidgets-body-flush');
        let now = new Date();
        const face = drawingArea(this.width - 20, this.height - 20, (cr, w, h, s) => paintFace(cr, w, h, s, now),
            {x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true});
        this.fill(face);
        this.watch(this.ctx.sources.clock, date => {
            now = date;
            face.queue_repaint();
        });
    }

    _digital() {
        const time = label('', 'gwidgets-clock-time');
        const date = label('', 'gwidgets-clock-date');
        const left = box(true, 'gwidgets-clock-left', {x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        left.add_child(time);
        left.add_child(date);

        const week = label('', 'gwidgets-dim');
        const yearText = label('', 'gwidgets-dim');
        let yearPart = 0;
        let dayPart = 0;
        const dayText = label('', 'gwidgets-dim');
        const dayBar = drawingArea(118, 6, (cr, w, h) => paintBar(cr, w, h, dayPart, ORANGE));
        const yearBar = drawingArea(118, 6, (cr, w, h) => paintBar(cr, w, h, yearPart, [1, 1, 1]));
        const right = box(true, 'gwidgets-clock-right', {y_align: Clutter.ActorAlign.CENTER});
        [week, spacer(), dayText, dayBar, yearText, yearBar].forEach(c => right.add_child(c));

        const row = box(false, '', {x_expand: true, y_expand: true});
        row.add_child(left);
        row.add_child(right);
        this.fill(row);

        let minute = -1;
        this.watch(this.ctx.sources.clock, now => {
            if (now.getMinutes() === minute)
                return;
            minute = now.getMinutes();
            time.text = format(now, '%H:%M');
            date.text = format(now, '%A, %-d %B');
            week.text = _('Week %d').format(Number(format(now, '%V')));
            const start = new Date(now.getFullYear(), 0, 1);
            const end = new Date(now.getFullYear() + 1, 0, 1);
            yearPart = (now - start) / (end - start);
            dayPart = (now.getHours() * 60 + now.getMinutes()) / 1440;
            dayText.text = _('Day %d%%').format(Math.round(dayPart * 100));
            yearText.text = _('Year %d%%').format(Math.round(yearPart * 100));
            dayBar.queue_repaint();
            yearBar.queue_repaint();
        });
    }
}
