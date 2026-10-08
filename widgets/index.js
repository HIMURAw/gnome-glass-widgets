import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {BatteriesWidget} from './batteries.js';
import {CalendarWidget} from './calendar.js';
import {ClockWidget} from './clock.js';
import {FinanceWidget, MorningWidget, RemindersWidget} from './harvis.js';
import {MusicWidget} from './music.js';
import {NotesWidget} from './notes.js';
import {SystemWidget} from './system.js';
import {WeatherWidget} from './weather.js';

// Every kind of widget the gallery offers, in its order. `harvis` ones are offered only
// when the Harvis command is there.
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
        {type: 'reminders', name: _('Reminders'), description: _('What Harvis will remind you of'),
            icon: 'alarm-symbolic', sizes: ['small', 'medium'], make: RemindersWidget, harvis: true},
        {type: 'morning', name: _('Morning report'), description: _('Harvis’s summary of today and yesterday'),
            icon: 'weather-clear-symbolic', sizes: ['medium', 'large'], make: MorningWidget, harvis: true},
        {type: 'finance', name: _('Money'), description: _('Balances, this month and your goal'),
            icon: 'accessories-calculator-symbolic', sizes: ['small', 'medium'], make: FinanceWidget, harvis: true},
    ];
}
