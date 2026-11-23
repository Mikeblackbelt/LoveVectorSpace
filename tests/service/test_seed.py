from lvs_fakes import Events


def test_seed_demo(factory, conn):
    factory.seed_demo("u1", conn)
    svc = factory.for_user("u1", conn, Events())
    people = {p["pseudonym"]: p for p in svc.list_people()}
    assert set(people) == {"Yu Cheng", "Sam", "Jordan"}
    assert people["Yu Cheng"]["mode"] == "potential" and people["Sam"]["mode"] == "established"
    yid = people["Yu Cheng"]["id"]
    yu, sam, jordan = (svc.overview(people[n]["id"]) for n in ("Yu Cheng", "Sam", "Jordan"))
    assert yu["success"]["status"] == "ok" and yu["success"]["tag"].startswith("uncalibrated")
    assert 300 <= sum(u["message_count"] for u in svc.list_units(yid)) <= 500
    assert [w["covered"] for w in yu["weekly"]].count(False) >= 2  # the two-week coverage gap
    assert {s["scale_id"] for s in yu["scales"]} == {"reciprocity", "disclosure_balance", "breadcrumbing"}
    assert any(m["status"] == "ok" for m in yu["interaction_metrics"])
    assert len(svc.list_facts(yid)) >= 3 and len(svc.list_interactions(yid)) >= 3
    assert yu["next_steps"] and yu["safety"]["flags"] == []
    assert any(f["severity"] == "concern" for f in sam["safety"]["flags"]) and sam["safety"]["resources"]
    assert people["Sam"]["safety"] == "concern"
    assert {s["source"] for s in people["Sam"]["sources"]} == {"whatsapp_import", "discord_ext"}
    assert {s["scale_id"] for s in sam["scales"]} == {"csi16"}
    assert jordan["success"]["status"] == "insufficient_data" and jordan["success"]["percent"] is None
    factory.seed_demo("u1", conn)  # idempotent
    assert len(svc.list_people()) == 3
