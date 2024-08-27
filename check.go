package main

import (
	"fmt"
	"go/parser"
	"go/scanner"
	"go/token"
	"os"
)

func main() {
	fset := token.NewFileSet() // positions are relative to fset

	src, _ := os.ReadFile("./output.go.txt")
	_, err := parser.ParseFile(fset, "", src, parser.AllErrors|parser.SkipObjectResolution)
	if err == nil {
		return
	}

	switch err := err.(type) {
	case scanner.ErrorList:
		for _, e := range err {
			fmt.Printf("output.go.txt:%s\n", e)
		}
	default:
		fmt.Printf("%T\n", err)
	}
}
