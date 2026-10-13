import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const BLUR_RADIUS = 20;

// Blur is the costly part; with it off every glass is a plain dark surface.
// Set before building any glass (the extension rebuilds when it changes).
let blurEnabled = true;

export function setBlurEnabled(enabled) {
    blurEnabled = enabled;
}

// GJS turns whole numbers into int GValues, which float uniforms ignore.
const asFloat = v => (Number.isInteger(v) ? v + 1e-4 : v);

const MASK_SHADER = `
uniform sampler2D tex;
uniform float width;
uniform float height;
uniform float radius;
uniform float tex_w;
uniform float tex_h;
uniform float frame_width;
uniform float frame_r;
uniform float frame_g;
uniform float frame_b;
uniform float frame_a;

void main(void) {
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 color = texture2D(tex, uv);
    // The offscreen texture is a little larger than the actor (its paint box, rounded out):
    // place the shape by the texture's real size, centred, not stretched over it.
    vec2 tex_size = vec2(tex_w, tex_h);
    vec2 half_size = vec2(width, height) * 0.5;
    vec2 q = abs(uv * tex_size - tex_size * 0.5) - (half_size - vec2(radius));
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float outer = clamp(0.5 - dist, 0.0, 1.0);
    // The frame is drawn here, along the same rounded edge as the cut, so it follows the
    // corners too (a CSS border is clipped away there by this very mask).
    float inner = frame_width > 0.0 ? clamp(0.5 - (dist + frame_width), 0.0, 1.0) : outer;
    vec4 frame = vec4(frame_r, frame_g, frame_b, 1.0) * frame_a;
    vec4 over = frame + color * (1.0 - frame_a);
    cogl_color_out = color * inner + over * (outer - inner);
}`;

// Cuts an actor to a rounded rectangle with antialiased edges.
const RoundedMask = GObject.registerClass(
class RoundedMask extends Clutter.ShaderEffect {
    _init() {
        super._init();
        this.set_shader_source(MASK_SHADER);
    }

    setGeometry(width, height, radius) {
        if (width === this._w && height === this._h && radius === this._r)
            return;
        this._w = width;
        this._h = height;
        this._r = radius;
        this.set_uniform_value('width', asFloat(width));
        this.set_uniform_value('height', asFloat(height));
        this.set_uniform_value('radius', asFloat(radius));
    }

    vfunc_paint_target(node, paintContext) {
        // In device pixels; the shape is in logical ones (fractional scaling: 1.67).
        const [ok, dw, dh] = this.get_target_size();
        const scale = this.actor?.get_resource_scale?.() || 1;
        const tw = dw / scale;
        const th = dh / scale;
        if (ok && (tw !== this._tw || th !== this._th)) {
            this._tw = tw;
            this._th = th;
            this.set_uniform_value('tex_w', asFloat(tw));
            this.set_uniform_value('tex_h', asFloat(th));
        }
        super.vfunc_paint_target(node, paintContext);
    }

    // A frame along the rounded edge: [r, g, b, a] 0..1 and its width in px; width 0 for none.
    setFrame(rgba, width) {
        const key = `${rgba}|${width}`;
        if (key === this._frame)
            return;
        this._frame = key;
        this.set_uniform_value('frame_width', asFloat(width));
        ['frame_r', 'frame_g', 'frame_b', 'frame_a'].forEach((name, i) =>
            this.set_uniform_value(name, asFloat(rgba[i])));
    }
});

// The frame colour comes from the stylesheet, so states (hover, editing, playing) can change it:
//   -glass-frame-color: rgba(...);  -glass-frame-width: 1px;
function themeFrame(actor) {
    const node = actor.get_theme_node();
    const [ok, c] = node.lookup_color('-glass-frame-color', false);
    if (!ok)
        return [[0, 0, 0, 0], 0];
    const ch = k => (typeof c[`get_${k}`] === 'function' ? c[`get_${k}`]() : c[k] / 255);
    const [hasWidth, width] = node.lookup_length('-glass-frame-width', false);
    return [[ch('red'), ch('green'), ch('blue'), ch('alpha')], hasWidth ? width : 1];
}

// The wallpaper behind the widget, blurred. Widgets live among the windows (below
// all of them), so unlike the island and the dock they cannot clone the window
// group, which holds them; the background group is what is under them anyway.
const Backdrop = GObject.registerClass(
class Backdrop extends St.Widget {
    _init() {
        super._init({clip_to_allocation: true, x_expand: true, y_expand: true});
        this._tint = new St.Widget({
            style_class: blurEnabled ? 'gwidgets-tint' : 'gwidgets-tint gwidgets-solid',
        });
        const source = Main.layoutManager._backgroundGroup;
        if (!blurEnabled || !source) {
            this.add_child(this._tint);
            return;
        }
        this._clone = new Clutter.Clone({source});
        this.add_child(this._clone);
        this.add_child(this._tint);
        this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, radius: BLUR_RADIUS, brightness: 0.85});
        this.add_effect(this._blur);
    }

    vfunc_get_preferred_width(_forHeight) {
        return [0, 0];
    }

    vfunc_get_preferred_height(_forWidth) {
        return [0, 0];
    }

    vfunc_allocate(box) {
        this.set_allocation(box);
        this._tint.allocate(new Clutter.ActorBox({x1: 0, y1: 0, x2: box.get_width(), y2: box.get_height()}));
        if (!this._clone)
            return;
        // Lined up with the screen, so the blur shows exactly what is behind.
        const [px, py] = this.get_parent().get_transformed_position();
        const x = px + box.x1;
        const y = py + box.y1;
        const [w, h] = global.stage.get_size();
        this._clone.allocate(new Clutter.ActorBox({x1: -x, y1: -y, x2: -x + w, y2: -y + h}));
        const side = Math.min(box.get_width(), box.get_height());
        this._blur.enabled = side >= 4;
        this._blur.radius = Math.max(1, Math.min(BLUR_RADIUS, Math.floor(side / 3)));
    }
});

// Frosted glass container: children are stacked (BinLayout) on the blur, and
// everything, content included, is clipped to the rounded shape.
export const Glass = GObject.registerClass(
class Glass extends St.Widget {
    _init({radius, ...params}) {
        super._init({...params, clip_to_allocation: true, layout_manager: new Clutter.BinLayout()});
        this._radius = radius;
        this.backdrop = new Backdrop();
        this.add_child(this.backdrop);
        this._mask = new RoundedMask();
        this.add_effect(this._mask);
        this.connect('style-changed', () => this._mask.setFrame(...themeFrame(this)));
        this._mask.setFrame([0, 0, 0, 0], 0);
    }

    vfunc_allocate(box) {
        super.vfunc_allocate(box);
        const w = box.get_width();
        const h = box.get_height();
        this._mask.enabled = w >= 1 && h >= 1;
        this._mask.setGeometry(w, h, Math.min(this._radius, w / 2, h / 2));
    }

    // Call when the glass moves without being re-laid out (dragging).
    syncBackdrop() {
        this.backdrop.queue_relayout();
    }
});
