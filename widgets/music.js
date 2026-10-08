import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Widget} from '../widget.js';
import {box, label, placeholder, spacer} from '../ui.js';

// What is playing (Spotify, a browser, any MPRIS player): cover, title, controls.
// The cover opens the player.
export class MusicWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this.target = () => ctx.sources.media.raise();
        this.watch(ctx.sources.media, m => this._render(m));
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
        row.add_child(this.button(m.playing ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic',
            () => media.playPause(), big ? 'gwidgets-control gwidgets-control-main' : 'gwidgets-round-button', big ? 22 : 16));
        if (big)
            row.add_child(this.button('media-skip-forward-symbolic', () => media.next(), 'gwidgets-control', 18));
        return row;
    }

    _render(m) {
        if (!m?.title) {
            const empty = placeholder(_('Nothing playing'));
            this.fill(this.header(_('Music'), 'gwidgets-pink'), empty);
            return;
        }
        if (this.size === 'small') {
            const top = box(false, '', {x_expand: true});
            top.add_child(this._cover(m, 64));
            top.add_child(spacer());
            if (m.app)
                top.add_child(new St.Icon({gicon: m.app.get_icon(), icon_size: 20, y_align: Clutter.ActorAlign.START}));
            const bottom = box(false, '', {x_expand: true});
            const text = box(true, '', {x_expand: true, y_align: Clutter.ActorAlign.END});
            text.add_child(label(m.title, 'gwidgets-music-title'));
            text.add_child(label(m.artist, 'gwidgets-dim'));
            bottom.add_child(text);
            const c = this._controls(m, false);
            c.y_align = Clutter.ActorAlign.END;
            bottom.add_child(c);
            this.fill(top, spacer(), bottom);
            return;
        }
        const row = box(false, 'gwidgets-music-row', {x_expand: true, y_expand: true});
        row.add_child(this._cover(m, this.height - 36));
        const right = box(true, 'gwidgets-music-right', {x_expand: true});
        const app = box(false, 'gwidgets-music-app');
        if (m.app)
            app.add_child(new St.Icon({gicon: m.app.get_icon(), icon_size: 14}));
        app.add_child(label(m.playing ? _('Now playing') : _('Paused'), 'gwidgets-caption gwidgets-pink'));
        right.add_child(app);
        right.add_child(label(m.title, 'gwidgets-music-title gwidgets-music-title-big'));
        right.add_child(label(m.artist, 'gwidgets-dim'));
        right.add_child(spacer());
        right.add_child(this._controls(m, true));
        row.add_child(right);
        this.fill(row);
    }
}
