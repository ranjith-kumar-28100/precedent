"""Builds vendors.json, history.json, upcoming.json (hand-authored data) and validates them."""
import json, os, re
D = os.path.dirname(os.path.abspath(__file__))
P, M, E = "Priya Nair", "Marcus Webb", "Elena Rossi"
T = ["competing_quote","volume_commit","multi_year","quarter_end_timing","bundle","escalate_to_exec","payment_terms"]

V = [
 ("v01","Northwind Cloudworks","SaaS licences","Dana Whitfield, Account Executive",486000,
  dict(list_markup=0.24,floor_discount=0.22,works="competing_quote",fails="escalate_to_exec",decision_maker="Regional Sales Director",quirk="Opens with a 'special' 5% discount that expires in 48 hours; folds quickly once a named rival quote is on the table.")),
 ("v02","Brightline CRM","SaaS licences","Tomas Brandt, Senior Account Manager",312000,
  dict(list_markup=0.19,floor_discount=0.18,works="quarter_end_timing",fails="multi_year",decision_maker="VP Sales Operations",quirk="Always sends a revised quote 2 days before quarter end; treats multi-year asks as a chance to lock in price escalators.")),
 ("v03","Halvorsen Freight Lines","freight/logistics","Gudrun Halvorsen, Key Accounts Manager",1240000,
  dict(list_markup=0.15,floor_discount=0.15,works="volume_commit",fails="competing_quote",decision_maker="Director of Network Planning",quirk="Prices lanes, not totals; rewards guaranteed weekly tonnage and gets defensive when told about rival carriers.")),
 ("v04","TransPacific Haulage Co.","freight/logistics","Kenji Okafor, Commercial Lead",895000,
  dict(list_markup=0.13,floor_discount=0.12,works="payment_terms",fails="volume_commit",decision_maker="CFO",quirk="Cash-flow obsessed; will trade rate for faster payment, but volume commitments make them add minimum-charge clauses.")),
 ("v05","Kestrel Alloys Ltd","raw materials","Rhys Calloway, Sales Manager",2150000,
  dict(list_markup=0.16,floor_discount=0.14,works="multi_year",fails="quarter_end_timing",decision_maker="Chief Commercial Officer",quirk="Indexes to LME; only moves on price when offered 24+ months of certainty. Quarter-end pressure makes them dig in.")),
 ("v06","Mondrian Polymers","raw materials","Ilse Verhoeven, Regional Account Director",1480000,
  dict(list_markup=0.20,floor_discount=0.17,works="bundle",fails="payment_terms",decision_maker="Head of Commercial",quirk="Hates discounting a single grade; gives real money when resin, masterbatch and packaging are bought together.")),
 ("v07","Aldercrest Contract Manufacturing","contract manufacturing","Fiona McBride, Business Development Manager",3300000,
  dict(list_markup=0.22,floor_discount=0.20,works="escalate_to_exec",fails="competing_quote",decision_maker="COO",quirk="Account managers have no authority; the COO's office produces a 'strategic partner' rate within a week of an exec-to-exec call.")),
 ("v08","Sintra Precision Assembly","contract manufacturing","Joao Almeida, Account Manager",1760000,
  dict(list_markup=0.18,floor_discount=0.16,works="quarter_end_timing",fails="bundle",decision_maker="Plant General Manager",quirk="Plant has capacity gaps at end of each quarter and will fill them at near-floor pricing; resists bundled NRE and unit pricing.")),
 ("v09","CleanSpan Facilities Group","facilities services","Marguerite Doyle, Regional Manager",640000,
  dict(list_markup=0.21,floor_discount=0.19,works="bundle",fails="escalate_to_exec",decision_maker="Regional Operations Director",quirk="Cross-sells janitorial, security and grounds; bristles when bypassed by senior contacts.")),
 ("v10","Meridian Building Services","facilities services","Carlos Echeverria, Contracts Manager",410000,
  dict(list_markup=0.14,floor_discount=0.13,works="multi_year",fails="competing_quote",decision_maker="Managing Director",quirk="Staff-retention driven; offers best rate on 3-year terms, treats rival quotes as a sign the buyer is not serious.")),
 ("v11","Packetry Security Inc.","SaaS licences","Naomi Sandoval, Enterprise AE",720000,
  dict(list_markup=0.30,floor_discount=0.25,works="escalate_to_exec",fails="payment_terms",decision_maker="Chief Revenue Officer",quirk="Starting quote carries a heavy cushion; AE is capped at 8% and routes everything larger to the CRO.")),
 ("v12","Ironbridge Steel Supply","raw materials","Walt Dziedzic, Inside Sales Lead",1920000,
  dict(list_markup=0.12,floor_discount=0.11,works="volume_commit",fails="multi_year",decision_maker="VP Sales",quirk="Thin-margin distributor; moves only on tonnage commitments and refuses to fix price beyond 90 days.")),
]

# (vendor, date, buyer, tactic, ask, final, outcome, decision_maker_seen, notes)
H = [
# v01
("v01","2025-05-14",P,"volume_commit",0.15,0.06,"partial","Account Executive","Call with Dana Whitfield on the 240-seat renewal. She opened with a 'special' 5% off that had to be signed within 48 hours. Offered to commit to 300 seats; she came back at 6% and said anything more needed sign-off from her director."),
("v01","2025-08-06",M,"escalate_to_exec",0.20,0.04,"lost","VP Sales (escalated)","I emailed their VP of Sales directly about the Q3 add-on. Dana replied within the hour, visibly annoyed, and the revised quote came back at just 4% off list ($466k). Whole thing felt like we got pushed back to square one."),
("v01","2025-11-18",P,"competing_quote",0.20,0.19,"won","Regional Sales Director","Shared the PipelineIQ proposal ($391k for equivalent modules). Dana went to Raj Menon (Regional Sales Director) and we had 19% off within two days, $393.7k annual. Raj said the 'special' expired only 'if we hadn't been in touch', so the 48-hour clock was theatre."),
("v01","2026-02-10",E,"competing_quote",0.21,0.21,"won","Regional Sales Director","Added a second quote from a different vendor and asked for 21%. Raj approved on the call, $384k. Dana said it was a good thing we asked early."),
("v01","2026-05-27",P,"competing_quote",0.22,0.10,"partial","VP Revenue Operations","Northwind was acquired by Stratus Group in April; Raj has left and a new VP Revenue Operations (Alan Pierce) is now signing discounts. Rival quote only got us 10% since Alan wanted to 'align to group pricing guidelines'. He asked for a follow-up in Q3 once the integration settles."),
("v01","2026-09-09",M,"competing_quote",0.20,0.18,"won","VP Revenue Operations","Alan Pierce took the rival quote seriously after we gave him the full line-item comparison. 18% off, $398.5k annual. Regional Sales Director role no longer exists on their org chart."),
# v02
("v02","2025-05-22",P,"multi_year",0.18,0.05,"lost","Senior Account Manager","Proposed a 3-year deal to Tomas Brandt for 18% off. He agreed to 5% only if we accepted a 7% annual price escalator. Walked away; the escalator would have wiped out the savings by year 3."),
("v02","2025-06-26",M,"quarter_end_timing",0.15,0.15,"won","VP Sales Operations","Let the quarter run and signed on June 27. Tomas sent a revised quote on June 26 at 15% off, $265.2k, without us pushing. He admitted they were 'about $2M light' for Q2."),
("v02","2025-10-02",E,"competing_quote",0.16,0.07,"partial","Senior Account Manager","Mentioned a rival quote at the start of October, right after quarter began. Tomas held at 7% and said Lena Kruger (VP Sales Ops) had 'no flexibility until the numbers close'. Parked until December."),
("v02","2025-12-29",P,"quarter_end_timing",0.17,0.17,"won","VP Sales Operations","Waited until Dec 29, revised quote arrived with 17% off ($259k) the day before I planned to call. Lena Kruger approved at the end-of-year review; Tomas copied her on the thread."),
("v02","2026-03-27",M,"quarter_end_timing",0.18,0.18,"won","VP Sales Operations","Same pattern again, a revised quote landed March 27 at 18% off list for the add-on seats ($255.8k). Tomas apologised for the 'late-quarter scramble'. We are comfortable that late March is the sweet spot."),
# v03
("v03","2025-05-30",E,"competing_quote",0.12,0.03,"lost","Key Accounts Manager","Mentioned two rival bids on the Chicago-Dallas lanes. Gudrun Halvorsen went quiet for a week and returned with a 3% lane reduction and a note that spot capacity 'is tight in July'. Relationship noticeably cooler."),
("v03","2025-08-20",P,"volume_commit",0.12,0.12,"won","Director of Network Planning","Committed to 85 loads per week on the core lanes for 12 months. Gudrun brought in Soren Lindqvist (Director of Network Planning) and he approved 12% off the lane rates, about $148.8k annualised savings. Fuel surcharge table unchanged."),
("v03","2025-12-04",M,"volume_commit",0.14,0.14,"won","Director of Network Planning","Raised the weekly commitment to 110 loads on the Midwest corridor. Soren signed off 14% on those lanes within a day. Gudrun noted the committed tonnage 'let us staff the dedicated tractors'."),
("v03","2026-03-18",E,"payment_terms",0.12,0.06,"partial","Key Accounts Manager","Asked for net-45 instead of net-30 in return for a rate cut. Gudrun gave a flat 6% but said terms are corporate policy. Rates moved less than volume did last time."),
("v03","2026-07-15",P,"volume_commit",0.15,0.15,"won","Director of Network Planning","Soren is now handling renegotiation himself after Gudrun moved to the Pacific region. Committed 125 loads weekly through Q2 2027; 15% off lanes, which is the best Halvorsen rate on record. Soren wants quarterly volume reports."),
# v04
("v04","2025-06-12",M,"volume_commit",0.10,0.01,"lost","Commercial Lead","Offered 40,000 TEU-equivalents annual volume. Kenji Okafor added a minimum charge per sailing that cancelled out the rate cut, net about 1% savings. We declined."),
("v04","2025-09-18",P,"payment_terms",0.09,0.09,"won","CFO","Offered to pay net-10 rather than net-45. Kenji took it to the CFO, Ananya Rao, who approved 9% off the base rate ($80.5k). Kenji said their working-capital line is 'what keeps me up at night'."),
("v04","2025-12-09",E,"competing_quote",0.08,0.02,"lost","Commercial Lead","Dropped a competitor's number on the Shanghai-LA lane. Kenji said it was not comparable and offered 2%. Ananya was not looped in."),
("v04","2026-04-02",P,"payment_terms",0.12,0.12,"won","CFO","Went to net-7 via early-pay platform for a 12% rate reduction ($107k). Ananya approved in a single email. Kenji joked that if the platform fee is ours, 'we have a deal'."),
("v04","2026-09-24",M,"volume_commit",0.10,0.02,"lost","Commercial Lead","Tried one more time with a firm 50k TEU commitment. Same minimum-charge clause reappeared (now $140 per empty sailing). Kenji said volume on its own was not what drove their pricing."),
# v05
("v05","2025-05-08",E,"quarter_end_timing",0.12,0.02,"lost","Sales Manager","Pushed Rhys Calloway at quarter-end. He said the LME index moved up 3% that week and refused anything below the index plus premium. Gave 2% on freight only."),
("v05","2025-08-14",P,"multi_year",0.12,0.12,"won","Chief Commercial Officer","Offered a 36-month supply agreement for 4,200 tonnes per year. Rhys escalated to Priscilla Hartmann (CCO) who approved 12% off premium over LME. Said she needs contract certainty to justify hedging."),
("v05","2025-11-25",M,"competing_quote",0.10,0.04,"partial","Sales Manager","Cited a Turkish mill quote. Rhys agreed to 4% on the spot component and left the premium alone. Priscilla not involved."),
("v05","2026-02-19",P,"multi_year",0.13,0.14,"won","Chief Commercial Officer","Extended to a 48-month term with an index collar. Priscilla Hartmann signed 14% off the premium, $301k a year. Best figure Kestrel has given us to date."),
("v05","2026-06-30",E,"quarter_end_timing",0.10,0.03,"lost","Sales Manager","Quarter-end ask again. Rhys said Q2 was already booked and that nothing changes because of the calendar. 3% on freight consolidation only."),
# v06
("v06","2025-06-05",P,"payment_terms",0.12,0.02,"lost","Regional Account Director","Offered net-15 for lower resin pricing. Ilse Verhoeven said credit insurance already covers extended terms and prompt pay 'is not a lever'. Got a 2% courtesy cut."),
("v06","2025-09-11",M,"volume_commit",0.10,0.06,"partial","Regional Account Director","Committed 1,800 tonnes of HDPE, got 6% on that grade only. Ilse suggested adding other grades but we didn't have them in scope."),
("v06","2025-12-16",E,"bundle",0.15,0.16,"won","Head of Commercial","Bundled HDPE, masterbatch and stretch film packaging into one PO. Head of Commercial Stefan Brouwer approved 16% across the basket, $236.8k. Ilse said it was 'the cleanest deal we've done'."),
("v06","2026-04-22",P,"bundle",0.16,0.17,"won","Head of Commercial","Added PP copolymer to the bundle. Stefan matched with 17% on the whole basket, which equals the best offer on file. Quote returned within 36 hours."),
("v06","2026-08-27",M,"escalate_to_exec",0.14,0.08,"partial","Head of Commercial","Wrote to the CEO to speed up a contract. Stefan took over from Ilse and gave 8% but made it clear he would have done the bundle at 16% if we'd simply asked."),
# v07
("v07","2025-05-19",M,"competing_quote",0.15,0.03,"lost","Business Development Manager","Told Fiona McBride we had a bid from a Vietnam EMS provider. She said 'we do not compete on price against offshore' and offered 3% on NRE. Sent nothing in writing."),
("v07","2025-08-28",P,"escalate_to_exec",0.18,0.18,"won","COO","Our VP Ops called Aldercrest COO Bernard Tashkent directly. By Friday we had a 'strategic partner' rate of 18% off the unit price on the 3 SKU family ($594k). Fiona said she'd been kept out of the loop."),
("v07","2025-11-11",E,"payment_terms",0.12,0.05,"partial","Business Development Manager","Asked for net-60 to net-30 trade. Fiona offered 5% and said payment terms are a 'finance conversation'. Not worth repeating."),
("v07","2026-02-24",P,"escalate_to_exec",0.20,0.20,"won","COO","Second exec-to-exec call with Bernard on the new line. 20% off, which is Aldercrest's best known number. Fiona was copied on the thread but said nothing."),
("v07","2026-06-17",M,"volume_commit",0.15,0.07,"partial","Business Development Manager","Volume commitment of 120k units. Fiona gave 7% and said the COO's office 'would have to bless anything bigger'. We didn't re-escalate."),
("v07","2026-10-13",P,"escalate_to_exec",0.19,0.17,"won","COO","Bernard's chief of staff, Hye-jin Park, now coordinates. Call got scheduled within 24 hours and 17% was approved a week later. Process is a little slower than before but still works."),
# v08
("v08","2025-06-03",E,"bundle",0.12,0.02,"lost","Plant General Manager","Tried bundling NRE tooling and unit pricing. Joao Almeida said Sintra's accounting keeps these separate and quoted 2% only. Plant GM Luis Ferreira not in the call."),
("v08","2025-09-23",P,"quarter_end_timing",0.14,0.14,"won","Plant General Manager","Let the quote sit until Sept 24. Joao called with a 14% offer on the PCBA line because Luis Ferreira had open capacity in October. $246.4k saved annually."),
("v08","2025-12-22",M,"competing_quote",0.12,0.06,"partial","Account Manager","Mentioned a rival quote; Joao shrugged and offered 6%. The real movement only came at the quarter end, which we did not use."),
("v08","2026-03-24",P,"quarter_end_timing",0.15,0.16,"won","Plant General Manager","Pushed ahead to the last week of March. Luis Ferreira personally approved 16% off, citing a cancelled order from another customer. This is their floor as far as I can tell."),
("v08","2026-09-21",E,"quarter_end_timing",0.15,0.15,"won","Plant General Manager","Same play in Sept. 15% with a 4-week lead time, signed Sept 25. Joao says the plant reviews utilisation weekly in the final month."),
# v09
("v09","2025-05-27",M,"escalate_to_exec",0.15,0.04,"lost","Regional Manager","Went above Marguerite Doyle to the Operations Director on the janitorial contract. Marguerite reacted sharply and the final offer was 4%. She would not take our calls for two weeks."),
("v09","2025-08-13",P,"bundle",0.17,0.17,"won","Regional Operations Director","Combined janitorial, security and grounds across three sites into one agreement. Marguerite and Pete Ostrowski (Regional Operations Director) approved 17% off ($108.8k). They asked us to add landscape as a bonus."),
("v09","2025-11-04",E,"volume_commit",0.12,0.07,"partial","Regional Manager","Added two more buildings; Marguerite gave 7% on the extra scope only."),
("v09","2026-03-11",P,"bundle",0.19,0.19,"won","Regional Operations Director","Extended bundle with pest control and window cleaning. Pete signed 19% off the combined $640k base. Marguerite is leaving at the end of April."),
("v09","2026-07-29",M,"bundle",0.18,0.15,"won","Regional Operations Director","New Regional Manager, Dwayne Fuller, took over. He still needs Pete's approval for bundled deals. 15% since Dwayne did not know about the earlier terms."),
# v10
("v10","2025-06-17",E,"competing_quote",0.10,0.01,"lost","Contracts Manager","Presented a rival offer for HVAC maintenance. Carlos Echeverria said 'we assume you are not serious'. 1% via fuel savings. Cold afterwards."),
("v10","2025-10-09",P,"multi_year",0.12,0.12,"won","Managing Director","Offered 36 months to Meridian. MD Elena Castro approved 12% off ($49.2k per year) and agreed to cap CPI uplift at 3%. Carlos said stable contracts help them retain technicians."),
("v10","2026-01-21",M,"volume_commit",0.08,0.04,"partial","Contracts Manager","Added two buildings; 4% off per building. Carlos said the rate is 'already set for 3-year customers'."),
("v10","2026-06-02",P,"multi_year",0.13,0.13,"won","Managing Director","Extended to a 5-year renewal. 13% and CPI cap 2.5%, signed by Elena Castro. Carlos notes that 5 years was the first time we met their top of the card."),
# v11
("v11","2025-05-12",M,"payment_terms",0.15,0.04,"lost","Enterprise AE","Offered annual prepay upfront. Naomi Sandoval said it was nice, gave 4%, and said the CRO decides on anything over 8%."),
("v11","2025-08-26",P,"escalate_to_exec",0.22,0.22,"won","Chief Revenue Officer","Our CIO called CRO Isaac Moreau. Naomi's original quote of $720k came down 22% ($561.6k). Isaac wanted a case study as part of it."),
("v11","2025-12-10",E,"competing_quote",0.18,0.08,"partial","Enterprise AE","Rival quote got an 8% revised quote. Naomi said that was the maximum she could grant."),
("v11","2026-04-14",P,"escalate_to_exec",0.24,0.25,"won","Chief Revenue Officer","Second call with Isaac. 25% off the expansion, a record. He said they were closing the half-year strongly and he could 'be flexible'."),
("v11","2026-09-30",M,"payment_terms",0.15,0.05,"lost","Enterprise AE","Tried prepaying again for a 3-year deal. Naomi gave 5%, Isaac not involved."),
# v12
("v12","2025-06-09",P,"multi_year",0.08,0.00,"lost","Inside Sales Lead","Asked for a 24-month fixed price on rebar. Walt Dziedzic refused to fix price beyond 90 days and gave no discount."),
("v12","2025-09-30",M,"volume_commit",0.07,0.07,"won","VP Sales","Committed 6,000 tonnes over two quarters. VP Sales Gary Lindholm gave 7% below mill-plus. Walt said, 'tonnage is what I can sell upstairs'."),
("v12","2026-01-15",E,"payment_terms",0.06,0.02,"partial","Inside Sales Lead","Offered net-10. Walt said it helps their credit line but it gave just 2%."),
("v12","2026-05-06",P,"volume_commit",0.09,0.10,"won","VP Sales","Committed 9,500 tonnes over two quarters. Gary approved 10% under mill-plus pricing, $192k savings. Priced valid for 60 days."),
("v12","2026-10-20",M,"volume_commit",0.10,0.11,"won","VP Sales","11% off on 12,000 tonnes over 6 months, the best I have seen on the file. Gary said mills are over-supplied now, which helps."),
]

U = [
("v01","Renew 420-seat annual licence at or below 18% off list","Stratus Group integration is underway; Alan Pierce signs discounts. We have a quote from PipelineIQ at $391k.","2026-12-15"),
("v03","Re-bid Midwest and Texas lanes for 2027 at 14%+ off","Our weekly volume rose to 130 loads. Fuel surcharge table must remain unchanged.","2026-12-01"),
("v05","Lock in 2027-2030 premium over LME on 4,500 tonnes per year","Current contract ends Dec 31. Market tightness from Turkish export restrictions.","2026-12-20"),
("v07","Negotiate unit price on new controller assembly family (150k units/yr)","Product launch in Q2 2027. Fiona is the day-to-day contact.","2027-01-10"),
("v08","Secure rate on Q1 2027 PCBA build, target 15%","Utilisation at the plant is reportedly low in December. Luis Ferreira is the GM.","2026-12-18"),
("v11","Expand endpoint licences by 40% with 3-year term","Naomi Sandoval is the AE; CRO Isaac Moreau hosted our last call. Budget approved at $540k.","2027-01-15"),
]

vendors=[dict(id=i,name=n,category=c,contact=ct,list_price_usd_annual=p,hidden=h) for i,n,c,ct,p,h in V]
hist=[dict(vendor_id=v,date=d,buyer=b,tactic_used=t,ask_discount=a,final_discount=f,outcome=o,notes=n,decision_maker_seen=dm) for v,d,b,t,a,f,o,dm,n in H]
hist.sort(key=lambda e:(e["vendor_id"],e["date"]))
up=[dict(vendor_id=v,objective=o,context=c,deadline=d) for v,o,c,d in U]
for n,o in [("vendors",vendors),("history",hist),("upcoming",up)]:
    json.dump(o,open(os.path.join(D,n+".json"),"w"),indent=2,ensure_ascii=False)

# validation
iso=re.compile(r"^\d{4}-\d{2}-\d{2}$"); ids={v["id"] for v in vendors}
assert len(vendors)==12 and len(up)==6
fl={v["id"]:v["hidden"]["floor_discount"] for v in vendors}
assert {v["hidden"]["works"] for v in vendors}==set(T)
cnt={}
for e in hist:
    assert e["vendor_id"] in ids and e["tactic_used"] in T and iso.match(e["date"])
    assert "2025-05-01"<=e["date"]<="2026-11-06"
    assert 0<=e["final_discount"]<=fl[e["vendor_id"]]+1e-9,(e["vendor_id"],e["date"])
    assert e["outcome"] in("won","partial","lost")
    cnt[e["vendor_id"]]=cnt.get(e["vendor_id"],0)+1
assert all(4<=c<=8 for c in cnt.values()) and len(cnt)==12
for u in up: assert u["vendor_id"] in ids and iso.match(u["deadline"])
print("OK",len(vendors),len(hist),len(up),cnt)
