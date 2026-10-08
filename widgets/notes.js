import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';

import {Widget} from '../widget.js';
import {box, label, paragraph, placeholder, spacer} from '../ui.js';

function ago(date) {
    const minutes = Math.round((Date.now() - date) / 60000);
    if (minutes < 1)
        return _('just now');
    if (minutes < 60)
        return _('%d min ago').format(minutes);
    const hours = Math.round(minutes / 60);
    if (hours < 24)
        return _('%d h ago').format(hours);
    return GLib.DateTime.new_from_unix_local(Math.floor(date / 1000)).format('%-d %b');
}

// A small dialog for a new note: widgets sit under the windows and cannot take the
// keyboard themselves.
const NoteDialog = class {
    static open(onSave) {
        const dialog = new ModalDialog.ModalDialog({styleClass: 'gwidgets-note-dialog'});
        const entry = new St.Entry({style_class: 'gwidgets-note-entry', hint_text: _('A new note…'), can_focus: true,
            x_expand: true});
        entry.clutter_text.single_line_mode = false;
        entry.clutter_text.line_wrap = true;
        dialog.contentLayout.add_child(label(_('New note'), 'gwidgets-note-dialog-title'));
        dialog.contentLayout.add_child(entry);
        const save = () => {
            const text = entry.get_text();
            dialog.close();
            if (text.trim())
                onSave(text);
        };
        entry.clutter_text.connect('activate', save);
        dialog.setButtons([
            {label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape},
            {label: _('Save'), action: save, default: true},
        ]);
        dialog.open();
        dialog.setInitialKeyFocus(entry);
    }
};

export class NotesWidget extends Widget {
    constructor(ctx, size) {
        super(ctx, size);
        this.watch(ctx.sources.notes, data => this._render(data));
    }

    _open(path) {
        try {
            Gio.AppInfo.launch_default_for_uri(GLib.filename_to_uri(path, null), global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error('Glass Widgets: could not open the note', e);
        }
    }

    _render(data) {
        this.target = data?.folder ? {uri: GLib.filename_to_uri(data.folder, null)} : null;
        const add = this.button('list-add-symbolic', () => NoteDialog.open(text => this.ctx.sources.notes.add(text)),
            'gwidgets-round-button gwidgets-yellow-button', 14);
        const head = this.header(_('Notes'), 'gwidgets-yellow', add);
        if (!data?.folder) {
            this.fill(head, placeholder(_('Choose a notes folder in the settings')));
            return;
        }
        if (!data.notes.length) {
            this.fill(head, placeholder(data.missing ? _('Folder not found') : _('No notes yet')));
            return;
        }
        if (this.size === 'small') {
            const n = data.notes[0];
            const note = new St.Button({style_class: 'gwidgets-note-button', x_expand: true, y_expand: true, can_focus: false});
            const col = box(true, '', {x_expand: true});
            col.add_child(paragraph(n.text, 'gwidgets-note-text', 110));
            note.child = col;
            note.connect('clicked', () => this._open(n.path));
            this.fill(head, note, spacer(), label(ago(n.modified), 'gwidgets-dim gwidgets-tiny'));
            return;
        }
        const list = box(true, 'gwidgets-note-list', {x_expand: true, y_expand: true});
        data.notes.slice(0, this.size === 'large' ? 6 : 3).forEach(n => {
            const row = new St.Button({style_class: 'gwidgets-note-row', x_expand: true, can_focus: false});
            const col = box(true, '', {x_expand: true});
            const top = box(false);
            top.add_child(label(n.title, 'gwidgets-note-title', {x_expand: true}));
            top.add_child(label(ago(n.modified), 'gwidgets-dim gwidgets-tiny', {y_align: Clutter.ActorAlign.CENTER}));
            col.add_child(top);
            if (n.text !== n.title)
                col.add_child(label(n.text, 'gwidgets-dim'));
            row.child = col;
            row.connect('clicked', () => this._open(n.path));
            list.add_child(row);
        });
        this.fill(head, list);
    }
}
