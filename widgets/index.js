import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {BatteriesWidget} from './batteries.js';
import {CalendarWidget} from './calendar.js';
import {ClockWidget} from './clock.js';
import {NetworkWidget} from './connections.js';
import {MusicWidget} from './music.js';
import {NotesWidget} from './notes.js';
import {SystemWidget} from './system.js';
import {WeatherWidget} from './weather.js';

// Every kind of widget the gallery offers, in its order.
export function widgetTypes() {
    return [
        {type: 'clock', name: _('Clock'), description: _('A watch face, or the time in big digits'),
            icon: 'preferences-system-time-symbolic', sizes: ['small', 'medium'], make: ClockWidget},
        {type: 'calendar', name: _('Calendar'), description: _('Today, the month and what is coming'),
            icon: 'x-office-calendar-symbolic', sizes: ['small', 'medium', 'large'], make: CalendarWidget},
        {type: 'weather', name: _('Weather'), description: _('Now, the next hours and days'),
            icon: 'weather-few-clouds-symbolic', sizes: ['small', 'medium', 'large'], make: WeatherWidget},
        {type: 'music', name: _('Music'), description: _('What is playing, with controls'),
            icon: 'audio-x-generic-symbolic', sizes: ['small', 'medium'], make: MusicWidget},
        {type: 'notes', name: _('Notes'), description: _('Your latest notes; add one'),
            icon: 'document-edit-symbolic', sizes: ['small', 'medium', 'large'], make: NotesWidget},
        {type: 'system', name: _('System'), description: _('Processor, memory and disk'),
            icon: 'org.gnome.SystemMonitor-symbolic', sizes: ['small', 'medium'], make: SystemWidget},
        {type: 'batteries', name: _('Batteries'), description: _('This computer and Bluetooth devices'),
            icon: 'battery-good-symbolic', sizes: ['small', 'medium'], make: BatteriesWidget},
        {type: 'network', name: _('Network'), description: _('Speed, the connection, ping and Tailscale'),
            icon: 'network-wireless-symbolic', sizes: ['small', 'medium', 'large'], make: NetworkWidget},
    ];
}
