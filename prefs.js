import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GlassWidgetsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 640);

        const page = new Adw.PreferencesPage({icon_name: 'preferences-system-symbolic'});
        window.add(page);

        // Widgets are placed on the desktop itself; this only opens the gallery there.
        const widgets = new Adw.PreferencesGroup({title: _('Widgets'),
            description: _('Right-click a widget on the desktop for its size, or edit them all at once.')});
        page.add(widgets);
        const edit = new Adw.ActionRow({title: _('Edit widgets'),
            subtitle: _('Shows the gallery on the desktop: add, drag and remove widgets')});
        const editButton = new Gtk.Button({label: _('Edit'), valign: Gtk.Align.CENTER, css_classes: ['suggested-action']});
        editButton.connect('clicked', () => {
            settings.set_boolean('editing', true);
            window.close();
        });
        edit.add_suffix(editButton);
        edit.activatable_widget = editButton;
        widgets.add(edit);
        const reset = new Adw.ActionRow({title: _('Start over'), subtitle: _('Back to the default widgets')});
        const resetButton = new Gtk.Button({label: _('Reset'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        resetButton.connect('clicked', () => settings.reset('layout'));
        reset.add_suffix(resetButton);
        widgets.add(reset);

        const look = new Adw.PreferencesGroup({title: _('Appearance')});
        page.add(look);
        const blur = new Adw.SwitchRow({title: _('Frosted glass'), subtitle: _('Blur the wallpaper behind widgets')});
        settings.bind('blur', blur, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(blur);
        const dim = new Adw.SwitchRow({title: _('Step back behind apps'),
            subtitle: _('Dim and grey the widgets while an app is in front')});
        settings.bind('dim', dim, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(dim);

        const data = new Adw.PreferencesGroup({title: _('Data')});
        page.add(data);
        const place = new Adw.EntryRow({title: _('Weather location (empty: from the network)')});
        settings.bind('weather-location', place, 'text', Gio.SettingsBindFlags.DEFAULT);
        data.add(place);

        const notes = new Adw.EntryRow({title: _('Notes folder')});
        settings.bind('notes-folder', notes, 'text', Gio.SettingsBindFlags.DEFAULT);
        const pick = new Gtk.Button({icon_name: 'folder-open-symbolic', valign: Gtk.Align.CENTER,
            css_classes: ['flat'], tooltip_text: _('Choose a folder')});
        pick.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: _('Notes folder')});
            dialog.select_folder(window, null, (d, res) => {
                try {
                    const folder = d.select_folder_finish(res);
                    let path = folder.get_path();
                    if (path.startsWith(GLib.get_home_dir()))
                        path = `~${path.slice(GLib.get_home_dir().length)}`;
                    settings.set_string('notes-folder', path);
                } catch {
                    // cancelled
                }
            });
        });
        notes.add_suffix(pick);
        data.add(notes);
    }
}
