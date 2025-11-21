# DIY Antenna Design Guide for RTL-SDR Radio Reception

A practical guide to designing and building antennas for FM and DAB radio reception.

## Table of Contents

1. [Basic Theory](#basic-theory)
2. [Simple Dipole (Omnidirectional)](#simple-dipole-omnidirectional)
3. [Dual Dipole (Crossed/Bi-Dipole)](#dual-dipole-crossedbi-dipole)
4. [Periodic Antennas](#periodic-antennas)
5. [Construction Tips](#construction-tips)
6. [Optimization and Testing](#optimization-and-testing)

---

## Basic Theory

### Wavelength Formula

All antenna calculations start with wavelength:

```
Wavelength (λ) = Speed of Light / Frequency
λ (meters) = 300 / Frequency (MHz)
```

**Examples:**

- FM 100 MHz: λ = 300 / 100 = 3.0 meters
- DAB 200 MHz: λ = 300 / 200 = 1.5 meters

### Velocity Factor

Real-world antennas are affected by wire diameter and nearby materials:

```
Effective Length = Calculated Length × Velocity Factor
```

**Common Velocity Factors:**

- Thin wire (1-2mm): 0.95
- Thick wire (6-10mm): 0.97
- Aluminum tubing (12-25mm): 0.98
- In free space (ideal): 1.00

**Rule of Thumb:** Start with 0.95 for DIY wire antennas.

---

## Simple Dipole (Omnidirectional)

### What is a Dipole?

A half-wave dipole is the fundamental antenna design:
- Two equal-length elements extending from center
- Total length = half wavelength (λ/2)
- Omnidirectional in horizontal plane
- Vertically polarized when mounted vertically

### Calculation Formula

```
Total Length = (300 / Frequency_MHz) × 0.5 × Velocity_Factor

Each Element = Total Length / 2
```

### Example 1: FM Band Center (98 MHz)

```
Step 1: Calculate wavelength
λ = 300 / 98 = 3.061 meters

Step 2: Half wavelength
λ/2 = 3.061 / 2 = 1.531 meters

Step 3: Apply velocity factor (0.95)
Total Length = 1.531 × 0.95 = 1.454 meters = 145 cm

Step 4: Each element
Each Element = 145 / 2 = 72.5 cm
```

**Result:** FM dipole = 145 cm total (72.5 cm per element)

### Example 2: DAB Band III Center (207 MHz)

```
Step 1: Calculate wavelength
λ = 300 / 207 = 1.449 meters

Step 2: Half wavelength
λ/2 = 1.449 / 2 = 0.725 meters

Step 3: Apply velocity factor (0.95)
Total Length = 0.725 × 0.95 = 0.689 meters = 69 cm

Step 4: Each element
Each Element = 69 / 2 = 34.5 cm
```

**Result:** DAB dipole = 69 cm total (34.5 cm per element)

### Quick Reference Table - Simple Dipole

| Band | Center Freq | Total Length | Per Element |
|------|-------------|--------------|-------------|
| FM Low (88 MHz) | 88 MHz | 161 cm | 81 cm |
| FM Mid (98 MHz) | 98 MHz | 145 cm | 73 cm |
| FM High (108 MHz) | 108 MHz | 132 cm | 66 cm |
| DAB Low (174 MHz) | 174 MHz | 82 cm | 41 cm |
| DAB Mid (207 MHz) | 207 MHz | 69 cm | 35 cm |
| DAB High (240 MHz) | 240 MHz | 59 cm | 30 cm |

*All values include velocity factor 0.95*

### Bandwidth Considerations

A simple dipole has limited bandwidth:
- Thin wire (2mm): ±5 MHz around center frequency
- Thick wire (10mm): ±10 MHz around center frequency
- Tubing (25mm): ±20 MHz around center frequency

**For wideband reception:** Use thicker elements or dual-band design.

---

## Dual Dipole (Crossed/Bi-Dipole)

### What is a Dual Dipole?

Two dipoles mounted at 90 degrees to each other:
- Better polarization diversity
- Reduces multipath fading
- Maintains omnidirectional pattern
- Each dipole same length as simple dipole

### Design Configurations

**Configuration 1: Diversity Reception (In-Phase)**
- Both dipoles connected in phase (0 degrees)
- Better signal consistency
- Reduces nulls in pattern
- Simple construction

**Configuration 2: Circular Polarization (Quadrature)**
- Dipoles fed 90 degrees out of phase
- True circular polarization
- Requires phasing network
- More complex construction

### Calculation (Same as Simple Dipole)

Each dipole calculated independently:

```
Dipole A Length = (300 / Frequency_MHz) × 0.5 × 0.95
Dipole B Length = (300 / Frequency_MHz) × 0.5 × 0.95
```

**Result:** Both dipoles identical length, crossed at 90 degrees.

### Example: DAB Dual Dipole (207 MHz)

```
Each Dipole:
- Total: 69 cm (from earlier calculation)
- Per element: 34.5 cm

Configuration:
- Dipole A: Horizontal (East-West)
- Dipole B: Horizontal (North-South)
- Crossing point: Center
- Vertical separation: 0 cm (same plane) or 5-10 cm (stacked)
```

### Mounting Options

**Option A: Crossed in Same Plane**
```
         Element A
             |
             |
Element B ---+--- Element B
             |
             |
         Element A
```
- Simple construction
- Good for diversity
- Minimal interaction

**Option B: Stacked with Spacing**
```
Dipole A: ----+----
              |
          5-10cm spacing
              |
Dipole B: ----+----
```
- Better isolation
- Easier feeding
- Requires vertical support

### Feeding the Dual Dipole

**Simple Parallel Feed (Diversity):**
```
RTL-SDR Coax → Power Splitter → Dipole A
                              → Dipole B
```

**Advantages:**
- Both dipoles active simultaneously
- Signal combining improves SNR
- Simple implementation

**Component:** 2-way power splitter (75 ohm or 50 ohm)

---

## Periodic Antennas

### What are Periodic Antennas?

Arrays of elements with systematic spacing:
- **Yagi-Uda:** Directional, high gain
- **Log-Periodic:** Wideband, directional
- Multiple elements work together
- More complex but higher performance

### Yagi-Uda Antenna

**Basic Structure:**
- Reflector: Longest element (behind driven element)
- Driven Element: Connected to feedline (dipole length)
- Director(s): Shorter elements (in front)

**Element Length Relationships:**
```
Driven Element = λ/2 × 0.95 (standard dipole calculation)
Reflector = Driven Element × 1.05 (5% longer)
Director 1 = Driven Element × 0.90 (10% shorter)
Director 2 = Driven Element × 0.85 (15% shorter)
Director 3 = Driven Element × 0.82 (18% shorter)
```

**Element Spacing:**
```
Reflector to Driven: 0.15λ to 0.25λ
Driven to Director 1: 0.10λ to 0.20λ
Director spacing: 0.15λ to 0.30λ
```

### Example: 3-Element Yagi for DAB (207 MHz)

```
Step 1: Calculate wavelength
λ = 300 / 207 = 1.449 meters

Step 2: Driven element (dipole)
Driven = (1.449 / 2) × 0.95 = 69 cm

Step 3: Reflector (5% longer)
Reflector = 69 × 1.05 = 72 cm

Step 4: Director (10% shorter)
Director = 69 × 0.90 = 62 cm

Step 5: Spacing
Reflector-Driven: 0.20λ = 0.20 × 1.449 = 29 cm
Driven-Director: 0.15λ = 0.15 × 1.449 = 22 cm
```

**Result:**
- Boom length: 51 cm (29 + 22)
- Reflector: 72 cm at position 0
- Driven: 69 cm at position 29 cm
- Director: 62 cm at position 51 cm
- Expected gain: 6-8 dBi
- Beamwidth: ~60 degrees

### Quick Yagi Design Table (DAB Band)

| Configuration | Elements | Gain | Beamwidth | Boom Length |
|---------------|----------|------|-----------|-------------|
| 3-element | Ref + DE + Dir | 6-8 dBi | 60° | 50 cm |
| 5-element | Ref + DE + 3 Dir | 9-11 dBi | 45° | 100 cm |
| 7-element | Ref + DE + 5 Dir | 11-13 dBi | 35° | 150 cm |

*DE = Driven Element, Ref = Reflector, Dir = Director*

### Log-Periodic Dipole Array (LPDA)

**Characteristics:**
- Wideband (3:1 frequency ratio typical)
- Constant gain across band
- Directional (like Yagi)
- More complex design

**Design Formula:**

```
Tau (τ) = Length ratio between adjacent elements (typically 0.7-0.9)
Sigma (σ) = Spacing factor (typically 0.05-0.15)

Element N Length = Element N-1 Length × τ
Element N Spacing = (Length N + Length N-1) / 2 × σ
```

**Practical LPDA for DAB (174-240 MHz):**

```
Choose τ = 0.85 (good bandwidth/gain compromise)
Choose σ = 0.10 (moderate spacing)

Longest element (174 MHz):
L1 = (300 / 174 / 2) × 0.95 = 82 cm

Subsequent elements:
L2 = 82 × 0.85 = 70 cm
L3 = 70 × 0.85 = 59 cm
L4 = 59 × 0.85 = 50 cm
L5 = 50 × 0.85 = 43 cm
L6 = 43 × 0.85 = 36 cm

Spacing calculations:
S1-2 = (82 + 70) / 2 × 0.10 = 7.6 cm
S2-3 = (70 + 59) / 2 × 0.10 = 6.5 cm
S3-4 = (59 + 50) / 2 × 0.10 = 5.5 cm
S4-5 = (50 + 43) / 2 × 0.10 = 4.7 cm
S5-6 = (43 + 36) / 2 × 0.10 = 4.0 cm
```

**Result:**
- Total boom length: ~28 cm
- 6 elements covering 174-240 MHz
- Gain: 6-8 dBi across band
- VSWR < 2:1 across entire DAB Band III

### When to Use Each Type

**Simple Dipole:**
- Omnidirectional coverage needed
- Urban environment with signals from all directions
- Simplest construction
- Good for scanning/exploration

**Dual Dipole:**
- Omnidirectional with better reliability
- Multipath environments
- Mobile/portable use
- Still simple construction

**Yagi:**
- Specific transmitter direction known
- Rural/distant reception
- Maximum gain needed
- Reject interference from other directions

**Log-Periodic:**
- Wide frequency range (FM + DAB combined)
- Directional gain needed
- Professional installation
- More complex construction

---

## Construction Tips

### Materials

**Wire/Rod Options:**

1. **Copper Wire (1-3mm)**
   - Pros: Easy to work with, good conductivity
   - Cons: Narrows bandwidth, can sag
   - Best for: Indoor dipoles, temporary antennas

2. **Aluminum Rod (6-10mm)**
   - Pros: Lightweight, doesn't corrode, wider bandwidth
   - Cons: Harder to solder
   - Best for: Outdoor dipoles, Yagi elements

3. **Brass Rod (4-8mm)**
   - Pros: Easy to work, good conductivity
   - Cons: Can tarnish
   - Best for: Indoor/sheltered outdoor use

4. **Aluminum Tubing (12-25mm)**
   - Pros: Very wide bandwidth, rigid
   - Cons: Requires special connectors
   - Best for: Professional Yagi/LPDA arrays

### Center Insulator/Feedpoint

**Simple Dipole:**
```
Element A --+-- Element B
           Coax center
           Coax shield
```

**Materials:**
- Plastic terminal block
- PVC pipe section
- 3D printed connector
- Purchased antenna center insulator

**Waterproofing:**
- Self-amalgamating tape
- Heat shrink tubing
- Silicone sealant
- Coax seal putty

### Boom Material (Yagi/LPDA)

**Options:**
- Wood (2x2 or 2x4): Simple, non-conductive, weatherproof treated
- PVC pipe (25-50mm): Lightweight, weatherproof, easy to drill
- Fiberglass rod: Professional grade, non-conductive
- Aluminum tube: Conductive, requires element isolation

### Element Mounting (Yagi/LPDA)

**Through-Boom Method:**
- Drill holes in boom
- Elements pass through boom
- Secure with compression clamps
- Isolate from boom if boom is metal

**U-Bolt Method:**
- U-bolts attach elements to boom
- Plastic or nylon U-bolts prevent shorting
- Easy adjustment
- Weather-resistant

### Impedance Matching

**Dipole Impedance:**
- Free space: ~73 ohms
- Near ground: 50-60 ohms
- RTL-SDR input: 75 ohms (but accepts 50 ohms)

**Matching Techniques:**

1. **Direct Connection (Simple)**
   - 75 ohm coax direct to dipole
   - Good enough for receive-only
   - VSWR 1.5:1 typical

2. **Folded Dipole**
   - Two parallel elements
   - 300 ohm impedance
   - Use 4:1 balun to 75 ohms
   - Better bandwidth

3. **Gamma Match (Yagi)**
   - Adjustable capacitor and rod
   - Matches boom-mounted dipole
   - Professional Yagi antennas use this

### Balun Requirements

**What is a Balun?**
- Balanced (antenna) to Unbalanced (coax)
- Prevents coax shield radiation
- Improves pattern and reception

**When to Use:**
- Recommended for all dipoles
- Essential for Yagi fed elements
- Less critical for receive-only

**Types:**
- 1:1 balun (most common)
- 4:1 balun (for folded dipole)
- Ferrite choke (simplest, works well)

**DIY Ferrite Choke Balun:**
```
1. Take 1-2 meters of coax
2. Coil 6-8 turns (15cm diameter)
3. Secure with cable ties
4. Place coil near antenna feedpoint
5. Acts as RF choke on shield
```

---

## Optimization and Testing

### Using the Plugin's Spectrum Scan

The antenna positioning tools in this plugin are perfect for optimization:

**Procedure:**
1. Install antenna at test position
2. Open plugin web manager → Antenna Positioning tab
3. Run RF Spectrum Scan
4. Note peak levels on target frequencies
5. Adjust antenna
6. Re-scan and compare
7. Repeat until optimal

### Length Adjustment

**Tuning a Dipole:**

```
If signal peaks BELOW target frequency → Dipole TOO LONG → Trim 5-10mm
If signal peaks ABOVE target frequency → Dipole TOO SHORT → Add length

Rule: 1% length change = 1% frequency shift
```

**Example:**
- Designed for 200 MHz
- Peaks at 195 MHz (2.5% low)
- Dipole 2.5% too long
- 70 cm dipole → trim 1.75 cm (70 × 0.025)

### Height Above Ground

**Effect on Performance:**

| Height | Effect |
|--------|--------|
| 0.1λ (15cm @ DAB) | Poor - ground losses |
| 0.25λ (38cm @ DAB) | Acceptable - minimal ground loss |
| 0.5λ (75cm @ DAB) | Good - low ground loss |
| 1.0λ (150cm @ DAB) | Excellent - negligible ground loss |

**Recommendation:** Mount at least 0.5λ above ground or metal objects.

### Polarization

**DAB/FM Transmitters:**
- Typically vertically polarized
- Some horizontal or circular

**Your Antenna:**
- Match transmitter polarization when known
- Vertical dipole for vertical transmissions
- Use crossed dipole if polarization unknown

**Testing:**
- Try vertical orientation
- Try horizontal orientation
- Use spectrum scan to compare
- Choose orientation with strongest signal

### Environmental Factors

**Avoid:**
- Metal roofs (shield signals)
- Dense foliage (absorbs VHF/UHF)
- Proximity to power lines (interference)
- Inside metal buildings (Faraday cage)

**Prefer:**
- Rooftop mounting
- Clear line of sight
- Away from electronic devices
- Outdoor installation

### DAB Channel Validation

Use the plugin's channel validation tool:

1. Build antenna to calculated dimensions
2. Mount in test position
3. Run Channel Validation on target channels
4. Note service counts per channel
5. Adjust antenna orientation
6. Re-validate
7. Find optimal position

**Good Result:**
- Sync achieved on all target channels
- High service counts (15+ services)
- Low validation time (10-15 seconds per channel)

---

## Design Workflow Summary

### For Omnidirectional Reception (Dipole)

1. **Choose center frequency:**
   - FM: 98 MHz
   - DAB: 207 MHz

2. **Calculate length:**
   ```
   Length = (300 / Freq_MHz / 2) × 0.95
   ```

3. **Build dipole:**
   - Cut two equal elements
   - Mount to center insulator
   - Connect coax

4. **Test with spectrum scan**

5. **Tune if needed:**
   - Trim for higher frequency
   - Add for lower frequency

### For Directional Reception (Yagi)

1. **Choose design frequency**

2. **Calculate driven element** (dipole formula)

3. **Calculate reflector** (5% longer)

4. **Calculate directors** (10%, 15%, 18% shorter)

5. **Calculate spacing** (0.15λ to 0.25λ)

6. **Build on boom:**
   - Reflector at rear
   - Driven element at calculated position
   - Directors at front

7. **Point toward transmitter**

8. **Test with spectrum scan**

9. **Optimize element lengths if needed**

### For Wideband Reception (LPDA)

1. **Define frequency range** (e.g., 174-240 MHz)

2. **Choose τ = 0.85** and **σ = 0.10**

3. **Calculate longest element** (lowest frequency)

4. **Calculate subsequent elements** (multiply by τ)

5. **Calculate spacing** between elements

6. **Build on boom** (longest at rear)

7. **Test across entire band** with spectrum scan

8. **Verify flat response** across frequency range

---

## Practical Examples

### Example 1: Simple DAB Dipole for Urban Reception

**Scenario:** Urban apartment, signals from multiple directions

**Design:**
```
Frequency: 207 MHz (DAB center)
Total length: 69 cm
Per element: 34.5 cm
Material: 3mm copper wire
Orientation: Vertical
```

**Construction:**
1. Cut two 35 cm pieces of wire
2. Strip 1 cm from each end
3. Solder to center terminal block
4. Connect coax (center to one element, shield to other)
5. Waterproof connections
6. Mount vertically near window

**Expected:** Reception of all local DAB ensembles

### Example 2: Dual Dipole for Portable DAB

**Scenario:** Mobile/portable use, unknown signal directions

**Design:**
```
Each dipole: 69 cm (34.5 cm per element)
Configuration: Crossed, in-phase
Material: 4mm aluminum rod
```

**Construction:**
1. Build two identical 69 cm dipoles
2. Mount crossed at 90 degrees
3. Use 2-way splitter for feeding
4. Connect to single coax
5. Mount on portable mast

**Expected:** Consistent reception regardless of orientation

### Example 3: 5-Element Yagi for Distant DAB

**Scenario:** Rural location, 50 km from transmitter, known direction

**Design:**
```
Center frequency: 207 MHz
Reflector: 72 cm
Driven: 69 cm
Director 1: 62 cm
Director 2: 59 cm
Director 3: 56 cm
Boom length: ~100 cm
```

**Construction:**
1. Use 5 cm PVC pipe for boom
2. Drill holes at calculated positions
3. Mount aluminum rod elements
4. Feed driven element
5. Point toward transmitter
6. Mount as high as practical

**Expected:** Strong reception from distant transmitter, 9-11 dBi gain

---

## Resources and References

### Online Calculators

Many online calculators can verify your calculations:
- Search: "dipole antenna calculator"
- Search: "Yagi antenna calculator"
- Enter frequency, get dimensions

**Note:** Always apply velocity factor (0.95) to calculator results.

### Recommended Reading

- ARRL Antenna Book (amateur radio reference)
- VK5DJ Yagi Calculator (excellent online tool)
- LPDA design resources (search "log periodic antenna design")

### Safety Notes

**Electrical Safety:**
- Antennas are receive-only, low voltage
- Keep away from power lines (lethal)
- Ground mast for lightning protection
- Never install during storms

**Mechanical Safety:**
- Secure mounting prevents falling
- Wind load considerations for large antennas
- Roof access safety precautions

---

## Conclusion

Antenna design follows straightforward formulas, but optimization requires testing. The spectrum scan and channel validation tools in this plugin make antenna optimization much easier than traditional trial-and-error methods.

Start with a simple dipole, test with the plugin tools, then progress to more complex designs if needed.

**Remember:**
- Longer antenna = lower frequency
- Shorter antenna = higher frequency  
- Thicker elements = wider bandwidth
- Height above ground matters
- Orientation affects polarization matching

**Use the plugin's antenna positioning tools to:**
- Verify antenna performance
- Compare different designs
- Optimize placement
- Validate channel reception

Good luck with your antenna projects!

---

*This guide is provided for educational purposes. Local regulations may apply to antenna installations. The RTL-SDR Radio plugin includes antenna positioning tools to assist with optimization.*
