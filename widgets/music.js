import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {Ticker, box, drawingArea, label, placeholder, spacer} from '../ui.js';

const PINK = [1, 0.216, 0.373];
// Three bars, each on its own rhythm, so they never line up.
const BARS = [{speed: 7.3, phase: 0}, {speed: 9.1, phase: 1.7}, {speed: 6.2, phase: 3.1}];

// What is playing (Spotify, a browser, any MPRIS player): cover, title, controls.
// The cover opens the player.
export class MusicWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this.target = () => ctx.sources.media.raise();
        this.watch(ctx.sources.media, m => this._render(m));
    }

    // Equaliser bars: they dance while something plays, lie low when paused.
    _bars(playing, height) {
        let t = 0;
        const area = drawingArea(Math.round(height * 1.15), height, (cr, w, h, s) => {
            const gap = 2 * s;
            const bw = (w - gap * (BARS.length - 1)) / BARS.length;
            cr.setSourceRGBA(...PINK, 1);
            BARS.forEach(({speed, phase}, i) => {
                const wave = Math.abs(Math.sin(t * speed + phase)) * 0.7 + Math.abs(Math.sin(t * speed * 0.53 + phase * 2)) * 0.3;
                const level = playing ? 0.22 + 0.78 * wave : 0.22;
                const bh = Math.max(bw, h * level);
                const x = i * (bw + gap);
                const r = bw / 2;
                cr.newSubPath();
                cr.arc(x + r, h - bh + r, r, Math.PI, 0);
                cr.arc(x + r, h - r, r, 0, Math.PI);
                cr.closePath();
                cr.fill();
            });
        }, {y_align: Clutter.ActorAlign.CENTER});
        if (playing) {
            new Ticker(area, this.ctx, time => {
                t = time;
                area.queue_repaint();
            });
        }
        return area;
    }

    // A new song: the cover settles in with a small overshoot, the words rise after it.
    // Play/pause: the main button gives a little pulse.
    _animate(m, cover, text, main) {
        const song = `${m.title}\u0000${m.artist}`;
        const changed = this._song !== undefined && this._song !== song;
        const toggled = !changed && this._playing !== undefined && this._playing !== m.playing;
        this._song = song;
        this._playing = m.playing;
        if (changed) {
            cover.set_pivot_point(0.5, 0.5);
            cover.set({scale_x: 0.86, scale_y: 0.86, opacity: 0});
            cover.ease({scale_x: 1, scale_y: 1, opacity: 255, duration: 420, mode: Clutter.AnimationMode.EASE_OUT_BACK});
            text.set({translation_y: 8, opacity: 0});
            text.ease({translation_y: 0, opacity: 255, duration: 360, delay: 90, mode: Clutter.AnimationMode.EASE_OUT_CUBIC});
        } else if (toggled && main) {
            main.set_pivot_point(0.5, 0.5);
            main.set({scale_x: 0.82, scale_y: 0.82});
            main.ease({scale_x: 1, scale_y: 1, duration: 320, mode: Clutter.AnimationMode.EASE_OUT_BACK});
        }
    }

    _cover(m, side) {
        const cover = new St.Button({style_class: 'gwidgets-cover', width: side, height: side, can_focus: false});
        if (m.artUrl) {
            const url = m.artUrl.replace(/"/g, '%22');
            cover.style = `background-image: url("${url}"); background-size: cover;`;
        } else {
            cover.child = new St.Icon({icon_name: 'audio-x-generic-symbolic', icon_size: Math.round(side / 2.6)});
        }
        cover.connect('clicked', () => this.ctx.sources.media.raise());
        return cover;
    }

    _controls(m, big) {
        const media = this.ctx.sources.media;
        const row = box(false, 'gwidgets-controls');
        if (big)
            row.add_child(this.button('media-skip-backward-symbolic', () => media.previous(), 'gwidgets-control', 18));
        this._main = this.button(m.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => media.playPause(), big ? 'gwidgets-control gwidgets-control-main' : 'gwidgets-round-button', big ? 22 : 16);
        row.add_child(this._main);
        if (big)
            row.add_child(this.button('media-skip-forward-symbolic', () => media.next(), 'gwidgets-control', 18));
        return row;
    }

    _render(m) {
        if (!m?.title) {
            this._song = this._playing = undefined;
            const empty = placeholder(_('Nothing playing'));
            this.fill(this.header(_('Music'), 'gwidgets-pink'), empty);
            return;
        }
        if (this.size === 'small') {
            const top = box(false, '', {x_expand: true});
            const cover = this._cover(m, 64);
            top.add_child(cover);
            top.add_child(spacer());
            const corner = box(true, 'gwidgets-music-corner', {y_align: Clutter.ActorAlign.START});
            if (m.app)
                corner.add_child(new St.Icon({gicon: m.app.get_icon(), icon_size: 20, x_align: Clutter.ActorAlign.END}));
            const bars = this._bars(m.playing, 12);
            bars.x_align = Clutter.ActorAlign.END;
            corner.add_child(bars);
            top.add_child(corner);
            const bottom = box(false, '', {x_expand: true});
            const text = box(true, '', {x_expand: true, y_align: Clutter.ActorAlign.END});
            text.add_child(label(m.title, 'gwidgets-music-title'));
            text.add_child(label(m.artist, 'gwidgets-dim'));
            bottom.add_child(text);
            const c = this._controls(m, false);
            c.y_align = Clutter.ActorAlign.END;
            bottom.add_child(c);
            this.fill(top, spacer(), bottom);
            this._animate(m, cover, text, this._main);
            return;
        }
        const row = box(false, 'gwidgets-music-row', {x_expand: true, y_expand: true});
        const cover = this._cover(m, this.height - 36);
        row.add_child(cover);
        const right = box(true, 'gwidgets-music-right', {x_expand: true});
        const app = box(false, 'gwidgets-music-app');
        if (m.app)
            app.add_child(new St.Icon({gicon: m.app.get_icon(), icon_size: 14}));
        app.add_child(label(m.playing ? _('Now playing') : _('Paused'), 'gwidgets-caption gwidgets-pink', {x_expand: true}));
        app.add_child(this._bars(m.playing, 12));
        right.add_child(app);
        const words = box(true, '', {x_expand: true});
        words.add_child(label(m.title, 'gwidgets-music-title gwidgets-music-title-big'));
        words.add_child(label(m.artist, 'gwidgets-dim'));
        right.add_child(words);
        right.add_child(spacer());
        right.add_child(this._controls(m, true));
        row.add_child(right);
        this.fill(row);
        this._animate(m, cover, words, this._main);
    }
}
