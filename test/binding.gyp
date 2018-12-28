{
  "targets": [
    {
      "target_name": "floatenv",
      "sources": [ "floatenv.cpp" ],
      "include_dirs": [
        "<!(node -e \"require('nan')\")"
      ]
    }
  ]
}
